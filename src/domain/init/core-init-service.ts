import path from "path";
import { Disposable, toDisposable } from "../../base/disposable.js";
import { ErrorUtils, UsageError } from "../../base/errors.js";
import { samePath, selfAndAncestors } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	DraftFileReader,
	FileDraft,
} from "../../platform/fs/draft-file-reader.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { ConfigService } from "../config/config-service.js";
import { DEFAULT_PROJECT_FILE } from "../config/config.js";
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
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { MigratedProject, ProjectMigration } from "./project-migration.js";
import { MigrationSetup } from "./migration-setup.js";

/** The flags that shape a new config, by the choice each gives; init takes none of them where a config exists. */
const SHAPING_FLAGS: Record<
	Exclude<keyof InitChoices, "agentRules" | "agentHook" | "skipGit">,
	true
> = { kind: true, language: true, sample: true, places: true };

/** The shaping flags given, as typed. */
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

/** The folder as `plan` leaves it, before any program it runs. */
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

/** What init reads of the folder and its tools, read once in a run however often it plans. */
interface FolderRead {
	readonly directory: InitDirectory;
	readonly migrated: MigratedProject | undefined;
	readonly agents: () => Promise<
		Result<{ file: AgentFile; hooks: AgentHooks }, Error>
	>;
	readonly toolchain: () => Promise<Setup<unknown>>;
	readonly needsGitInit: () => Promise<boolean>;
}

/** `make`, run the first time the result is asked for and then kept. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
	let made: Promise<T> | undefined;
	return () => (made ??= make());
}

/** What the summary asks before init writes, which names what it does. */
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
		private readonly fileSystemService: FileSystemService,
		private readonly promptService: PromptService,
		private readonly environmentService: EnvironmentService,
		private readonly toolchainService: ToolchainService,
		processService: ProcessService,
		private readonly locator: ToolLocator = new ToolLocator(processService),
		private readonly configService: ConfigService,
		private readonly writeService: WriteService,
		lifecycleService: LifecycleService
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
			locator,
			lifecycleService
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

	/** In a terminal the plan is shown once and accepted with Enter; Customise asks the questions it took the default of, each with its answer preselected, and shows the plan again. Backing out of Customise shows the plan it had. */
	private async review(
		options: InitOptions
	): Promise<Result<InitPlan | undefined, Error>> {
		const { ask = true, choices = {} } = options;
		const read = await this.read(options);
		if (read.isErr()) return read;
		if (!(ask && this.promptService.isInteractive))
			return this.planWithin(
				read.value,
				new InitQuestions(this.promptService, false, choices)
			);
		const prompts = new ReviewPrompts(this.promptService);
		let shown: { plan: InitPlan; customisable: boolean } | undefined;
		let mode: ReviewMode = "quick";
		for (;;) {
			prompts.begin(mode);
			const planned = await this.planWithin(
				read.value,
				new InitQuestions(this.promptService, true, choices, prompts)
			);
			if (planned.isErr()) return planned;
			if (planned.value) {
				if (prompts.asked === 0) return planned;
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

	/** The project the first registered migration finds in `folder`. */
	private async migrationIn(
		folder: string
	): Promise<Result<MigratedProject | undefined, Diagnostic[]>> {
		for (const migration of this.migrations) {
			const found = await migration.find(folder, this.fileSystemService);
			if (found.isErr() || found.value) return found;
		}
		return ok(undefined);
	}

	/** A project that another tool set up: the migration's configs in place of a new project's. */
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
			new MigrationSetup(
				directory,
				migrated,
				this.fileSystemService,
				this.configService
			),
			agents.value,
			await read.toolchain(),
		]);
	}

	/** A project that has a config: the agent rules and the hook only, which change no config, and only when a flag asks for them. */
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
				),
				entries.has(DEFAULT_PROJECT_FILE) &&
					(await this.git.tracks(directory, DEFAULT_PROJECT_FILE))
			)
		);
	}

	private async planIn(
		read: FolderRead,
		questions: InitQuestions
	): Promise<Result<InitPlan | undefined, Error>> {
		const agents = await this.agentSetupIn(read, questions);
		if (agents.isErr()) return agents;
		return this.planWith(read, questions, [
			new ProjectSetup(read.directory, questions, this.fileSystemService),
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

	/** The folder itself, else the nearest one above it that is there, where a program can run before the folder is made. */
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
		return ok(
			plan.value.gitInit
				? {
						...plan.value,
						gitInit: await read.needsGitInit(),
					}
				: plan.value
		);
	}

	registerMigration(migration: ProjectMigration): Disposable {
		this.migrations.add(migration);
		return toDisposable(() => this.migrations.delete(migration));
	}

	refreshAgentRules(folder: string): Promise<string[]> {
		return new AgentRules(this.fileSystemService, this.git).refresh(folder);
	}

	async check(plan: InitPlan): Promise<Result<void, Error>> {
		if (plan.configs.length === 0) return ok(undefined);
		const reader = new DraftFileReader(
			this.fileSystemService,
			draftOf(plan)
		);
		const selection = await this.configService.select(plan.configs, reader);
		if (selection.isErr()) return selection;
		const failure = (
			await this.writeService.check(selection.value, reader)
		).failure();
		return failure ? err(failure) : ok(undefined);
	}

	write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun = false
	): Promise<Result<void, Error>> {
		return this.writer.write(plan, onWritten, dryRun);
	}
}
