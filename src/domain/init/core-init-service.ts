import path from "path";
import { ErrorUtils, ProjectError, UsageError } from "../../base/errors.js";
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
	InitPurpose,
	InitService,
	InitWritten,
	PresentItem,
} from "./init-service.js";
import { InitAdditions } from "./init-additions.js";
import { ReviewMode, ReviewPrompts } from "./review-prompts.js";
import { InitSummary } from "./init-summary.js";
import { Setup } from "./setup.js";
import { ProjectSetup } from "./project-setup.js";
import { ToolchainSetup } from "./toolchain-setup.js";
import { ServerFinder } from "../runner/server-finder.js";
import { ToolLocator } from "../toolchain/tool-locator.js";

const NEW_PROJECT_FLAGS: readonly (readonly [keyof InitChoices, string])[] = [
	["language", "--language"],
	["kind", "--kind"],
	["skipGit", "--skip-git"],
	["projectFile", "--project-file"],
	["sample", "--sample"],
	["routes", "--route"],
	["unmatched", "--unmatched"],
	["sourcePaths", "--source-path"],
	["compiledPath", "--compiled-path"],
	["darklua", "--darklua"],
	["packages", "--package"],
];

const PURPOSE_QUESTIONS: Readonly<Record<InitPurpose, string>> = {
	create: "Create this project?",
	change: "Make these changes?",
};

/** The prompt services of a run: the one that takes the default of what a summary shows, and the one that always asks. */
interface RunPrompts {
	readonly quick: PromptService;
	readonly essential: PromptService;
}

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
			return await this.review(options);
		} catch (error) {
			if (error instanceof UsageError) return err(error);
			throw error;
		}
	}

	/** In a terminal the plan is shown once and accepted with Enter; Customise asks every question, each with its answer preselected, and shows the plan again. */
	private async review(
		options: InitOptions
	): Promise<Result<InitPlan | undefined, Error>> {
		const { ask = true } = options;
		if (!(ask && this.promptService.isInteractive))
			return this.planWithin(options, {
				quick: this.promptService,
				essential: this.promptService,
			});
		const prompts = new ReviewPrompts(this.promptService);
		let mode: ReviewMode = "quick";
		for (;;) {
			prompts.begin(mode);
			const planned = await this.planWithin(options, prompts);
			if (planned.isErr() || !planned.value || prompts.asked === 0)
				return planned;
			const verdict = await this.accepted(planned.value);
			if (verdict === "yes") return planned;
			if (verdict === "cancel") return ok(undefined);
			mode = "customise";
		}
	}

	private accepted(
		plan: InitPlan
	): Promise<"yes" | "customise" | "cancel" | undefined> {
		return this.promptService
			.select<"yes" | "customise" | "cancel">({
				message: PURPOSE_QUESTIONS[plan.purpose],
				description: InitSummary.lines(plan).join("\n"),
				choices: [
					{ value: "yes", label: "Yes" },
					{
						value: "customise",
						label: "Customise",
						hint: "ask every question",
					},
					{ value: "cancel", label: "Cancel" },
				],
				initialValue: "yes",
			})
			.then((answer) => answer ?? "cancel");
	}

	private async planWithin(
		{ ask = true, place, choices = {} }: InitOptions,
		prompts: RunPrompts
	): Promise<Result<InitPlan | undefined, Error>> {
		const { cwd } = this.environmentService;
		const folder = place === undefined ? cwd : path.resolve(cwd, place);
		const interactive = ask && this.promptService.isInteractive;
		const questions = new InitQuestions(
			prompts.quick,
			interactive,
			choices,
			prompts.essential
		);
		const directory = await this.prepare(folder, place !== undefined);
		if (directory.isErr()) return directory;
		const nested = await this.checkNested(directory.value, questions);
		if (nested.isErr() || nested.value === "cancelled")
			return nested.map(() => undefined);
		const planned = await this.planIn(directory.value, questions);
		return place === undefined || planned.isErr() || !planned.value
			? planned
			: ok({
					...planned.value,
					notes: [
						`No default.rogen.json is at or above ${place}, so init starts a project there.`,
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
		const agentFile = await this.agentReader.fileIn(directory);
		if (agentFile.isErr()) return agentFile;
		const hooks = await this.agentReader.hooksIn(directory);
		if (hooks.isErr()) return hooks;
		const agents = new AgentSetup(agentFile.value, hooks.value, questions);
		const manifests = await this.toolchainService.readManifests(
			directory.path
		);
		const tools = ToolchainSetup.of(
			async () =>
				ToolchainSetup.stateOf(
					directory.path,
					manifests,
					await this.existingFolder(directory.path),
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
		if (!directory.hasConfigs)
			return this.planWith(directory, questions, [
				new ProjectSetup(directory, questions, this.fileSystemService),
				agents,
				tools,
			]);
		this.rejectNewProjectFlags(choices, directory.configFiles[0]);
		const additions = new InitAdditions(
			questions,
			agentFile.value,
			hooks.value,
			tools,
			ToolchainSetup.pinnedIn(manifests),
			directory.path
		);
		const requested = additions.requested();
		if (requested)
			return this.planWith(directory, questions, requested, {
				present: additions.presentAsked(),
				purpose: "change",
			});
		const chosen = await additions.choose();
		if (chosen === undefined) return ok(undefined);
		if (chosen === "nothing") {
			const present = additions.present();
			return present.length > 0
				? this.planWith(directory, questions, [], {
						present,
						purpose: "change",
					})
				: err(
						new DiagnosticsError(
							directory.checkFree(directory.configFiles)
						)
					);
		}
		return this.planWith(directory, questions, chosen, {
			present: additions.presentAsked(),
			purpose: "change",
		});
	}

	/** A flag that answers a question of a new project is an error where a config exists, since `init` doesn't change one. */
	private rejectNewProjectFlags(
		choices: InitChoices,
		configFile: string
	): void {
		for (const [key, flag] of NEW_PROJECT_FLAGS)
			if (choices[key] !== undefined)
				throw new UsageError(
					`${flag} is for a new project, and ${configFile} exists.`,
					"init doesn't change a config. Edit the .rogen.json, then run 'rogen check'."
				);
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

	private async planWith(
		directory: InitDirectory,
		questions: InitQuestions,
		setups: readonly Setup<unknown>[],
		extras: {
			present?: readonly PresentItem[];
			notes?: readonly string[];
			purpose?: InitPurpose;
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
		builder.setPurpose(extras.purpose ?? "create");
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
