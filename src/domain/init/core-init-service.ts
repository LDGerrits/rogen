import path from "path";
import { Disposable, toDisposable } from "../../base/disposable.js";
import { ErrorUtils, UsageError } from "../../base/errors.js";
import {
	isInside,
	samePath,
	selfAndAncestors,
	toPosix,
} from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	RenameFix,
	isError,
	isRenameFix,
} from "../../platform/diagnostics/diagnostic.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	DraftFileReader,
	FileDraft,
} from "../../platform/fs/draft-file-reader.js";
import {
	FileSystemService,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { ignoresPathCase } from "../../base/platform.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { ConfigService } from "../config/config-service.js";
import {
	DEFAULT_PROJECT_FILE,
	PLACES_FOLDER,
	isDefaultConfigFileName,
} from "../config/config.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { WriteService } from "../write/write-service.js";
import { CodeFinder } from "./code-finder.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { AgentReader } from "./agent-reader.js";
import { InitWriter } from "./init-writer.js";
import { GitRepository } from "./git-repository.js";
import { AgentSetup } from "./agent-setup.js";
import { AgentRules } from "./agent/agent-rules.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import {
	InitAction,
	InitChoices,
	InitOptions,
	InitPlan,
	InitService,
	InitWritten,
	booleanFlag,
} from "./init-service.js";
import { ReviewMode, ReviewPrompts } from "./review-prompts.js";
import { InitSummary } from "./init-summary.js";
import { Setup } from "./setup.js";
import { ProjectSetup } from "./project-setup.js";
import { ToolchainSetup } from "./toolchain-setup.js";
import { ServerFinder } from "../runner/server-finder.js";
import { ToolLocator } from "../toolchain/tool-locator.js";
import {
	MigratedProject,
	PlannedMove,
	ProjectMigration,
} from "./project-migration.js";
import { MigrationSetup } from "./migration-setup.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

const SHAPING_FLAGS: Record<
	Exclude<keyof InitChoices, "agentRules" | "agentHook" | "skipGit">,
	true
> = { kind: true, language: true, sample: true, places: true };

function shapingFlagsOf(choices: InitChoices): string[] {
	return Object.keys(SHAPING_FLAGS).flatMap((choice) => {
		const value = choices[choice as keyof typeof SHAPING_FLAGS];
		if (value === undefined) return [];
		return [
			typeof value === "string"
				? `--${choice} ${value}`
				: booleanFlag(`--${choice}`, value),
		];
	});
}

function respelled(from: string, to: string): string {
	const before = path.basename(from);
	const after = path.basename(to);
	const at = [...after].findIndex(
		(letter, index) => letter !== before[index]
	);
	const word = /[A-Za-z0-9]/;
	let start = at;
	let end = at;
	while (start > 0 && word.test(after[start - 1])) start--;
	while (end < after.length && word.test(after[end])) end++;
	return after.slice(start, end);
}

const ROUTE_SPELLING_CODES: ReadonlySet<string> = new Set([
	"route.caseMismatch",
	"route.strayAt",
]);

function routeRespellings(
	diagnostics: readonly Diagnostic[]
): RenameFix["rename"][] {
	return diagnostics
		.filter(({ code }) => ROUTE_SPELLING_CODES.has(code))
		.flatMap(({ fixes }) => (fixes ?? []).filter(isRenameFix))
		.map(({ rename }) => rename)
		.filter(({ from, to }) => from.toLowerCase() === to.toLowerCase());
}

function draftOf(plan: InitPlan): FileDraft {
	const at = (relative: string) => path.join(plan.directory, relative);
	return {
		files: new Map(
			plan.files.map(({ fileName, content }) => [at(fileName), content])
		),
		directories: [plan.directory, ...plan.directories.map(at)],
		moves: plan.moves.map(({ from, to }) => ({
			from: at(from),
			to: at(to),
		})),
	};
}

interface FolderRead {
	readonly directory: InitDirectory;
	readonly migrated: MigratedProject | undefined;
	readonly agents: () => Promise<
		Result<{ file: AgentFile; hooks: AgentHooks }, Error>
	>;
	readonly toolchain: () => Promise<Setup<unknown>>;
	readonly needsGitInit: () => Promise<boolean>;
}

function once<T>(make: () => Promise<T>): () => Promise<T> {
	let made: Promise<T> | undefined;
	return () => (made ??= make());
}

const QUESTIONS: Readonly<Record<InitAction, string>> = {
	create: "Create this project?",
	lift: "Set up Rogen in this project?",
	migrate: "Migrate this project?",
	agents: "Add these agent files?",
};

export class CoreInitService implements InitService {
	declare readonly _serviceBrand: undefined;

	private readonly agentReader: AgentReader;
	private readonly writer: InitWriter;
	private readonly git: GitRepository;
	private readonly finder: ServerFinder;
	private readonly migrations = new Set<ProjectMigration>();

	constructor(
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@PromptService private readonly promptService: PromptService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService,
		@ToolchainService private readonly toolchainService: ToolchainService,
		@ToolLocator private readonly locator: ToolLocator,
		@ConfigService private readonly configService: ConfigService,
		@WriteService private readonly writeService: WriteService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		this.agentReader = instantiationService.createInstance(AgentReader);
		this.git = instantiationService.createInstance(GitRepository);
		this.finder = instantiationService.createInstance(ServerFinder);
		this.writer = instantiationService.createInstance(InitWriter, this.git);
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

	private async review(
		options: InitOptions
	): Promise<Result<InitPlan | undefined, Error>> {
		const { ask = true, choices = {} } = options;
		const read = await this.read(options);
		if (read.isErr()) return read;
		if (!(ask && this.promptService.isInteractive))
			return this.planWithin(
				read.value,
				this.instantiationService.createInstance(
					InitQuestions,
					false,
					choices,
					undefined
				)
			);
		const prompts = this.instantiationService.createInstance(ReviewPrompts);
		let shown: { plan: InitPlan; customisable: boolean } | undefined;
		let mode: ReviewMode = "quick";
		for (;;) {
			prompts.begin(mode);
			const planned = await this.planWithin(
				read.value,
				this.instantiationService.createInstance(
					InitQuestions,
					true,
					choices,
					prompts
				)
			);
			if (planned.isErr()) return planned;
			if (planned.value) {
				if (prompts.asked === 0 && planned.value.moves.length === 0)
					return planned;
				shown = {
					plan: planned.value,
					customisable: prompts.customisable > 0,
				};
			} else if (shown) prompts.undo();
			else return planned;
			const verdict = await this.accepted(shown.plan, shown.customisable);
			if (verdict === "yes") return ok(shown.plan);
			if (verdict === "cancel") return ok(undefined);
			mode = "customise";
		}
	}

	private accepted(
		plan: InitPlan,
		customisable: boolean
	): Promise<"yes" | "customise" | "cancel" | undefined> {
		return this.promptService
			.select<"yes" | "customise" | "cancel">({
				message: QUESTIONS[plan.action],
				description: InitSummary.lines(plan).join("\n"),
				choices: [
					{ value: "yes", label: "Yes" },
					...(customisable
						? [
								{
									value: "customise" as const,
									label: "Customise",
									hint: "change the defaults",
								},
							]
						: []),
					{ value: "cancel", label: "Cancel" },
				],
				initialValue: "yes",
			})
			.then((answer) => answer ?? "cancel");
	}

	private async read({
		place,
	}: InitOptions): Promise<Result<FolderRead, Error>> {
		const { cwd } = this.environmentService;
		const folder = place === undefined ? cwd : path.resolve(cwd, place);
		const directory = await this.prepare(folder, place !== undefined);
		if (directory.isErr()) return directory;
		const migrated = await this.migrationIn(directory.value.path);
		if (migrated.isErr()) return err(new DiagnosticsError(migrated.error));
		const stale = (
			await this.configService.staleConfigsIn(directory.value.path)
		).filter(
			({ resource }) =>
				!migrated.value?.from.some((file) =>
					samePath(path.join(directory.value.path, file), resource)
				)
		);
		if (stale.length > 0) return err(new DiagnosticsError([...stale]));
		return ok({
			directory: directory.value,
			migrated: migrated.value,
			agents: once(() => this.agentsIn(directory.value)),
			toolchain: once(() => this.toolchainSetupIn(directory.value)),
			needsGitInit: once(() => this.git.needsInit(directory.value.path)),
		});
	}

	private planWithin(
		read: FolderRead,
		questions: InitQuestions
	): Promise<Result<InitPlan | undefined, Error>> {
		if (read.migrated)
			return this.planMigrationIn(read, questions, read.migrated);
		if (read.directory.hasConfigs)
			return this.planAgentsIn(read, questions);
		return this.planIn(read, questions);
	}

	private async migrationIn(
		folder: string
	): Promise<Result<MigratedProject | undefined, Diagnostic[]>> {
		for (const migration of this.migrations) {
			const found = await migration.find(folder, this.fileSystemService);
			if (found.isErr() || found.value) return found;
		}
		return ok(undefined);
	}

	private async planMigrationIn(
		read: FolderRead,
		questions: InitQuestions,
		migrated: MigratedProject
	): Promise<Result<InitPlan | undefined, Error>> {
		const { directory } = read;
		const [shaping] = shapingFlagsOf(questions.choices);
		if (shaping !== undefined)
			throw new UsageError(
				`${shaping} shapes a new config, and init migrates ${migrated.label} here.`,
				"Leave the flag out; edit the configs init writes, then run 'rogen check'."
			);
		const agents = await this.agentSetupIn(read, questions);
		if (agents.isErr()) return agents;
		return this.planWith(read, questions, [
			this.instantiationService.createInstance(
				MigrationSetup,
				directory,
				migrated
			),
			agents.value,
			await read.toolchain(),
		]);
	}

	private async planAgentsIn(
		read: FolderRead,
		questions: InitQuestions
	): Promise<Result<InitPlan | undefined, Error>> {
		const { directory } = read;
		const { choices } = questions;
		const { configFiles } = directory;
		if (choices.agentRules !== true && choices.agentHook !== true)
			return err(new DiagnosticsError(directory.checkFree(configFiles)));
		const [shaping] = shapingFlagsOf(choices);
		if (shaping !== undefined)
			throw new UsageError(
				`${shaping} shapes a new config, and ${configFiles.join(", ")} is here already.`,
				"Beside a config, --agent-rules and --agent-hook add only the agent files. To change the config, edit it and run 'rogen check'."
			);
		const agents = await this.agentSetupIn(read, questions);
		if (agents.isErr()) return agents;
		if (agents.value.hookUnfound && choices.agentRules !== true)
			return err(
				new DiagnosticsError([
					AgentSetup.noCodingAgent(
						directory.path,
						DiagnosticSeverity.Error
					),
				])
			);
		return this.planWith(read, questions, [agents.value], "agents");
	}

	private async agentsIn(
		directory: InitDirectory
	): Promise<Result<{ file: AgentFile; hooks: AgentHooks }, Error>> {
		const file = await this.agentReader.fileIn(directory);
		if (file.isErr()) return file;
		const hooks = await this.agentReader.hooksIn(directory);
		if (hooks.isErr()) return hooks;
		return ok({ file: file.value, hooks: hooks.value });
	}

	private async agentSetupIn(
		read: FolderRead,
		questions: InitQuestions
	): Promise<Result<AgentSetup, Error>> {
		const agents = await read.agents();
		if (agents.isErr()) return agents;
		return ok(
			new AgentSetup(
				agents.value.file,
				agents.value.hooks,
				questions,
				read.directory.path
			)
		);
	}

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
				await this.instantiationService
					.createInstance(CodeFinder)
					.layoutOf(directory, workspace),
				entries.has(DEFAULT_PROJECT_FILE) &&
					(await this.git.tracks(directory, DEFAULT_PROJECT_FILE)),
				ignoresPathCase,
				await this.placeConfigsIn(directory)
			)
		);
	}

	private async placeConfigsIn(directory: string): Promise<string[]> {
		const found: string[] = [];
		const places = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(
				path.join(directory, PLACES_FOLDER)
			)
		);
		for (const [name, type] of places.isOk() ? places.value : []) {
			if (!isDirectoryType(type)) continue;
			const place = path.join(directory, PLACES_FOLDER, name);
			const listing = await tryWithAsync(() =>
				this.fileSystemService.readDirectory(place)
			);
			for (const [file] of listing.isOk() ? listing.value : [])
				if (isDefaultConfigFileName(file))
					found.push(path.posix.join(PLACES_FOLDER, name, file));
		}
		return found.sort();
	}

	private async planIn(
		read: FolderRead,
		questions: InitQuestions
	): Promise<Result<InitPlan | undefined, Error>> {
		const agents = await this.agentSetupIn(read, questions);
		if (agents.isErr()) return agents;
		return this.planWith(read, questions, [
			this.instantiationService.createInstance(
				ProjectSetup,
				read.directory,
				questions
			),
			agents.value,
			await read.toolchain(),
		]);
	}

	private async toolchainSetupIn(
		directory: InitDirectory
	): Promise<Setup<unknown>> {
		const manifests = await this.toolchainService.readManifests(
			directory.path
		);
		return new ToolchainSetup(
			once(async () =>
				ToolchainSetup.stateOf(
					directory.path,
					manifests,
					await this.existingFolder(directory.path),
					{
						finder: this.finder,
						locator: this.locator,
					}
				)
			)
		);
	}

	private async existingFolder(folder: string): Promise<string> {
		const folders = [...selfAndAncestors(folder)];
		for (const existing of folders)
			if (await this.fileSystemService.exists(existing)) return existing;
		return folders[folders.length - 1];
	}

	private async planWith(
		read: FolderRead,
		questions: InitQuestions,
		setups: readonly Setup<unknown>[],
		action?: InitAction
	): Promise<Result<InitPlan | undefined, Error>> {
		const answered: { setup: Setup<unknown>; choices: unknown }[] = [];
		for (const setup of setups) {
			const asked = await setup.ask();
			if (asked.isErr()) return err(new DiagnosticsError(asked.error));
			if (asked.value === undefined) return ok(undefined);
			answered.push({ setup, choices: asked.value });
		}

		const builder = new InitPlanBuilder(
			read.directory,
			questions.interactive,
			questions.decided,
			this.environmentService.cwd
		);
		if (action) builder.setAction(action);
		for (const { setup, choices } of answered) setup.plan(choices, builder);
		const plan = builder.build();
		if (plan.isErr()) return err(new DiagnosticsError(plan.error));
		const renamed = await this.withRouteSpellings(plan.value);
		return ok(
			renamed.gitInit
				? { ...renamed, gitInit: await read.needsGitInit() }
				: renamed
		);
	}

	private async withRouteSpellings(plan: InitPlan): Promise<InitPlan> {
		const failure = await this.writeCheckOf(plan);
		if (failure.isErr() || !(failure.value instanceof DiagnosticsError))
			return plan;
		const relative = (file: string) =>
			toPosix(path.relative(plan.directory, file));
		const written = plan.files.map(({ fileName }) => fileName);
		const isWritten = (from: string) =>
			written.some(
				(file) => file === from || file.startsWith(`${from}/`)
			);
		const renames = new Map<string, PlannedMove>();
		for (const rename of routeRespellings(failure.value.diagnostics))
			if (!isWritten(relative(rename.from)))
				renames.set(rename.from, {
					from: relative(rename.from),
					to: relative(rename.to),
					reason: `to match the route "${respelled(rename.from, rename.to)}"`,
				});
		if (renames.size === 0) return plan;
		const depth = ({ from }: PlannedMove) => from.split("/").length;
		return {
			...plan,
			moves: [
				...[...renames.values()].sort((a, b) => depth(b) - depth(a)),
				...plan.moves,
			],
		};
	}

	private async writeCheckOf(
		plan: InitPlan
	): Promise<Result<Error | undefined, Error>> {
		if (plan.configs.length === 0) return ok(undefined);
		const reader = this.instantiationService.createInstance(
			DraftFileReader,
			draftOf(plan)
		);
		const selection = await this.configService.select(plan.configs, reader);
		if (selection.isErr()) return err(selection.error);
		return ok(
			(await this.writeService.check(selection.value, reader)).failure()
		);
	}

	registerMigration(migration: ProjectMigration): Disposable {
		this.migrations.add(migration);
		return toDisposable(() => this.migrations.delete(migration));
	}

	refreshAgentRules(folder: string): Promise<string[]> {
		return this.instantiationService
			.createInstance(AgentRules, this.git)
			.refresh(folder);
	}

	async check(plan: InitPlan): Promise<Result<readonly Diagnostic[], Error>> {
		const checked = await this.writeCheckOf(plan);
		if (checked.isErr()) return checked;
		const failure = checked.value;
		if (!failure) return ok([]);
		const errors =
			failure instanceof DiagnosticsError
				? failure.diagnostics.filter(isError)
				: [];
		return errors.length > 0 &&
			errors.every((error) =>
				CoreInitService.isAboutUserCode(error, plan)
			)
			? ok(errors)
			: err(failure);
	}

	private static isAboutUserCode(error: Diagnostic, plan: InitPlan): boolean {
		const made = [
			...plan.files.map(({ fileName }) => fileName),
			...plan.moves.map(({ to }) => to),
		].map((file) => path.join(plan.directory, file));
		return [
			error.resource,
			...(error.related ?? []).map(({ resource }) => resource),
		].every(
			(file) =>
				isInside(file, plan.directory) &&
				!made.some((one) => samePath(one, file) || isInside(one, file))
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
