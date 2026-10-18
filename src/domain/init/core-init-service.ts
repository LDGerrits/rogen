import path from "path";
import { ErrorUtils, ProjectError, UsageError } from "../../base/errors.js";
import { toPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { ConfigService } from "../config/config-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { CodeFinder } from "./code-finder.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { AgentReader } from "./agent-reader.js";
import { InitWriter } from "./init-writer.js";
import { GitRepository } from "./git-repository.js";
import { AgentSetup } from "./agent-setup.js";
import {
	InitChoices,
	InitOptions,
	InitPlan,
	InitService,
	InitWritten,
	PresentItem,
} from "./init-service.js";
import { InitAdditions } from "./init-additions.js";
import { Setup } from "./setup.js";
import { PlaceFinder } from "../config/place-finder.js";
import { PlaceInit } from "./place-init.js";
import { ProjectSetup } from "./project-setup.js";
import { ToolchainSetup } from "./toolchain-setup.js";
import { ServerFinder } from "../runner/server-finder.js";
import { ToolLocator } from "../toolchain/tool-locator.js";

/** The choices that shape a new config, which a folder that has one doesn't take. */
const PROJECT_FLAGS: readonly (readonly [keyof InitChoices, string])[] = [
	["language", "--language"],
	["darklua", "--darklua"],
	["sourcePaths", "--source-path"],
	["syncPath", "--sync-path"],
	["projectFile", "--project-file"],
	["kind", "--kind"],
	["skipGit", "--skip-git"],
	["packages", "--package"],
	["routes", "--route"],
	["unmatched", "--unmatched"],
	["sample", "--sample"],
];

export class CoreInitService implements InitService {
	declare readonly _serviceBrand: undefined;

	private readonly agentReader: AgentReader;
	private readonly writer: InitWriter;
	private readonly git: GitRepository;
	private readonly finder: ServerFinder;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly promptService: PromptService,
		private readonly environmentService: EnvironmentService,
		private readonly toolchainService: ToolchainService,
		private readonly configService: ConfigService,
		private readonly processService: ProcessService,
		private readonly locator: ToolLocator = new ToolLocator(processService)
	) {
		this.agentReader = new AgentReader(fileSystemService);
		this.git = new GitRepository(processService, fileSystemService);
		this.finder = new ServerFinder(
			toolchainService,
			processService,
			locator
		);
		this.writer = new InitWriter(
			fileSystemService,
			this.git,
			processService,
			locator
		);
	}

	async plan(
		options: InitOptions = {}
	): Promise<Result<InitPlan | undefined, Error>> {
		try {
			return await this.planWithin(options);
		} catch (error) {
			if (error instanceof UsageError) return err(error);
			throw error;
		}
	}

	private async planWithin({
		ask = true,
		place,
		choices = {},
	}: InitOptions): Promise<Result<InitPlan | undefined, Error>> {
		const { cwd } = this.environmentService;
		const folder = place === undefined ? cwd : path.resolve(cwd, place);
		const enclosed =
			place !== undefined &&
			(await this.configService.findEnclosing(folder)) !== undefined;
		if (enclosed) {
			for (const [key, flag] of [
				["kind", "--kind"],
				["skipGit", "--skip-git"],
				["sample", "--sample"],
				["places", "--places"],
			] as const)
				if (choices[key] !== undefined)
					throw new UsageError(
						`${flag} is for a new project, and ${place} is below a rogen.json, so init adds a place there.`
					);
			return new PlaceInit(
				this.fileSystemService,
				new InitQuestions(
					this.promptService,
					ask && this.promptService.isInteractive,
					choices
				),
				this.toolchainService,
				this.configService,
				cwd
			).plan(place);
		}
		if (place !== undefined) {
			const flag =
				choices.placeIds !== undefined
					? "--place-id"
					: choices.placeListing !== undefined
						? "--place-listing"
						: undefined;
			if (flag)
				throw new UsageError(
					`${flag} is for a place folder, and ${place} is not below a rogen.json.`,
					"Run 'rogen init' in the folder that holds the code the places share first."
				);
		}
		const directory = await this.prepare(folder, place !== undefined);
		if (directory.isErr()) return directory;
		const interactive = ask && this.promptService.isInteractive;
		const questions = new InitQuestions(
			this.promptService,
			interactive,
			choices
		);
		const nested = await this.checkNested(directory.value, questions);
		if (nested.isErr() || nested.value === "cancelled")
			return nested.map(() => undefined);
		const planned = await this.planIn(directory.value, questions);
		return place === undefined || planned.isErr() || !planned.value
			? planned
			: ok({
					...planned.value,
					notes: [
						`No rogen.json is at or above ${place}, so init starts a project there.`,
						...planned.value.notes,
					],
				});
	}

	/** A run that can't ask refuses to start a project below a config. */
	private async checkNested(
		directory: InitDirectory,
		questions: InitQuestions
	): Promise<Result<"go" | "cancelled", Error>> {
		if (directory.hasConfigs) return ok("go");
		const enclosing = await this.configService.findEnclosing(
			directory.path
		);
		if (!enclosing) return ok("go");
		const answer = await questions.startNestedProject(enclosing);
		if (answer === undefined) return ok("cancelled");
		if (answer) return ok("go");
		if (questions.interactive) return ok("cancelled");
		return err(
			new ProjectError(
				`${enclosing.directory} already has ${enclosing.fileNames.join(", ")}, so this folder may already be part of that project.`,
				`To use that project, run rogen from there: cd ${enclosing.directory}. ` +
					`To start a separate project here anyway, run rogen init --nested.`
			)
		);
	}

	/** `mayBeNew`: the folder was named, and is made if it is not there. */
	private async prepare(
		directory: string,
		mayBeNew: boolean
	): Promise<Result<InitDirectory, Error>> {
		const missing =
			mayBeNew && !(await this.fileSystemService.exists(directory));
		const listing = !missing
			? await tryWithAsync(() =>
					this.fileSystemService.readDirectory(directory)
				)
			: ok([]);
		if (listing.isErr()) {
			return err(
				ErrorUtils.wrap(`Failed to read ${directory}`, listing.error)
			);
		}
		const entries = new Set(listing.value.map(([entry]) => entry));
		const workspace = await this.toolchainService.detect(directory);
		return ok(
			new InitDirectory(
				directory,
				entries,
				workspace,
				await new CodeFinder(this.fileSystemService).layoutOf(
					directory,
					workspace
				)
			)
		);
	}

	private async planIn(
		directory: InitDirectory,
		questions: InitQuestions
	): Promise<Result<InitPlan | undefined, Error>> {
		const placeOf = await this.projectRootOf(directory);
		if (placeOf.isErr()) return placeOf;
		const home = placeOf.value?.root ?? directory;
		const agentFile = await this.agentReader.fileIn(home);
		if (agentFile.isErr()) return agentFile;
		const hooks = await this.agentReader.hooksIn(home);
		if (hooks.isErr()) return hooks;
		const agents = new AgentSetup(agentFile.value, hooks.value, questions);
		const manifests = await this.toolchainService.readManifests(home.path);
		const tools = ToolchainSetup.of(
			await ToolchainSetup.stateOf(
				home.path,
				manifests,
				await this.existingFolder(home.path),
				{
					finder: this.finder,
					locator: this.locator,
					processService: this.processService,
				}
			),
			questions
		);
		const { choices } = questions;
		if (choices.agentHook === true && !hooks.value.inUse)
			throw new UsageError(
				"There is no hook to add.",
				"No coding agent folder here (.claude, .codex, .cursor, ...) was found."
			);
		if (directory.hasConfigs) {
			const ignored = PROJECT_FLAGS.filter(
				([key]) => choices[key] !== undefined
			).map(([, flag]) => flag);
			if (ignored.length > 0)
				throw new UsageError(
					`${directory.configFiles[0]} already exists, so ${joinedWithAnd(ignored)} would change nothing.`,
					"Edit it to change those, or add to it with --agent-rules, --agent-hook, --rojo or --studio-plugin."
				);
		}
		if (!directory.hasConfigs)
			return this.planWith(directory, questions, [
				new ProjectSetup(directory, questions, this.fileSystemService),
				agents,
				...(tools ? [tools] : []),
			]);
		const additions = new InitAdditions(
			questions,
			agentFile.value,
			hooks.value,
			tools,
			ToolchainSetup.pinnedIn(manifests),
			home.path
		);
		const notes = placeOf.value
			? [
					`${placeOf.value.rootFile} lists this folder as a place, so agent rules, the hook and Rojo go to the project root.`,
				]
			: [];
		const requested = additions.requested();
		if (requested)
			return this.planWith(home, questions, requested, {
				present: additions.presentAsked(),
				notes,
			});
		const options = additions.options();
		if (options.length === 0) {
			const present = additions.present();
			return present.length > 0
				? this.planWith(home, questions, [], { present, notes })
				: err(new DiagnosticsError(home.checkFree(home.configFiles)));
		}
		const addition = await questions.whatToAdd(
			home.configFiles[0],
			options
		);
		if (addition === undefined) return ok(undefined);
		return this.planWith(home, questions, [addition], {
			present: additions.presentAsked(),
			notes,
		});
	}

	/** The folder itself, else the nearest one above it that is there, where a program can run before the folder is made. */
	private async existingFolder(folder: string): Promise<string> {
		let existing = folder;
		while (!(await this.fileSystemService.exists(existing))) {
			const parent = path.dirname(existing);
			if (parent === existing) break;
			existing = parent;
		}
		return existing;
	}

	/** The project root that lists `directory` as a place, when `directory` is one. */
	private async projectRootOf(
		directory: InitDirectory
	): Promise<
		Result<{ root: InitDirectory; rootFile: string } | undefined, Error>
	> {
		if (!directory.hasConfigs) return ok(undefined);
		const rootConfig = await new PlaceFinder(this.fileSystemService).rootOf(
			directory.path
		);
		if (!rootConfig) return ok(undefined);
		const root = await this.prepare(path.dirname(rootConfig), false);
		if (root.isErr()) return root;
		return ok({
			root: root.value,
			rootFile: toPosix(
				path.relative(this.environmentService.cwd, rootConfig)
			),
		});
	}

	private async planWith(
		directory: InitDirectory,
		questions: InitQuestions,
		setups: readonly Setup<unknown>[],
		extras: {
			present?: readonly PresentItem[];
			notes?: readonly string[];
		} = {}
	): Promise<Result<InitPlan | undefined, Error>> {
		const answered: { setup: Setup<unknown>; choices: unknown }[] = [];
		for (const setup of setups) {
			const asked = await setup.ask();
			if (asked.isErr()) return err(new DiagnosticsError(asked.error));
			if (asked.value === undefined) return ok(undefined);
			answered.push({ setup, choices: asked.value });
		}

		const builder = new InitPlanBuilder(
			directory,
			questions.interactive,
			questions.decided,
			this.environmentService.cwd
		);
		for (const { setup, choices } of answered) setup.plan(choices, builder);
		for (const note of extras.notes ?? []) builder.addNote(note);
		builder.addPresent(...(extras.present ?? []));
		const plan = builder.build();
		if (plan.isErr()) return err(new DiagnosticsError(plan.error));
		return ok(
			plan.value.gitInit
				? {
						...plan.value,
						gitInit: await this.git.needsInit(plan.value.directory),
					}
				: plan.value
		);
	}

	write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun = false
	): Promise<Result<void, Error>> {
		return this.writer.write(plan, onWritten, dryRun);
	}
}
