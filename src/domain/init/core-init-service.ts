import path from "path";
import { ErrorUtils, UsageError } from "../../base/errors.js";
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
import { AgentRules } from "./agent/agent-rules.js";
import {
	InitChoices,
	InitOptions,
	InitPlan,
	InitService,
	InitWritten,
} from "./init-service.js";
import { ReviewMode, ReviewPrompts } from "./review-prompts.js";
import { InitSummary } from "./init-summary.js";
import { Setup } from "./setup.js";
import { ProjectSetup } from "./project-setup.js";
import { ToolchainSetup } from "./toolchain-setup.js";
import { ServerFinder } from "../runner/server-finder.js";
import { ToolLocator } from "../toolchain/tool-locator.js";

/** The flags that shape a new config, by the choice each gives; init takes none of them where a config exists. */
const SHAPING_FLAGS: Record<
	Exclude<keyof InitChoices, "agentRules" | "agentHook" | "skipGit">,
	string
> = {
	kind: "kind",
	language: "language",
	packages: "package",
	routes: "route",
	unmatched: "unmatched",
	sample: "sample",
	places: "places",
};

/** The shaping flags given, as typed. */
function shapingFlagsOf(choices: InitChoices): string[] {
	return Object.entries(SHAPING_FLAGS).flatMap(([choice, flag]) => {
		const value = choices[choice as keyof typeof SHAPING_FLAGS];
		if (value === undefined) return [];
		return [value === false ? `--no-${flag}` : `--${flag}`];
	});
}

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
		private readonly processService: ProcessService,
		private readonly locator: ToolLocator = new ToolLocator(processService),
		private readonly configService: ConfigService
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
				message: "Create this project?",
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
		const stale = await this.configService.staleConfigsIn(
			directory.value.path
		);
		if (stale.length > 0) return err(new DiagnosticsError([...stale]));
		if (directory.value.hasConfigs)
			return this.planAgentsIn(directory.value, questions);
		return this.planIn(directory.value, questions);
	}

	/** A project that has a config: the agent rules and the hook only, which change no config, and only when a flag asks for them. */
	private async planAgentsIn(
		directory: InitDirectory,
		questions: InitQuestions
	): Promise<Result<InitPlan | undefined, Error>> {
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
		const agents = await this.agentSetupIn(directory, questions);
		if (agents.isErr()) return agents;
		return this.planWith(directory, questions, [agents.value]);
	}

	private async agentSetupIn(
		directory: InitDirectory,
		questions: InitQuestions
	): Promise<Result<AgentSetup, Error>> {
		const agentFile = await this.agentReader.fileIn(directory);
		if (agentFile.isErr()) return agentFile;
		const hooks = await this.agentReader.hooksIn(directory);
		if (hooks.isErr()) return hooks;
		if (questions.choices.agentHook === true && !hooks.value.inUse)
			throw new UsageError(
				"There is no hook to add.",
				"No coding agent folder here (.claude, .codex, .cursor, ...) was found."
			);
		return ok(new AgentSetup(agentFile.value, hooks.value, questions));
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
		const agents = await this.agentSetupIn(directory, questions);
		if (agents.isErr()) return agents;
		const manifests = await this.toolchainService.readManifests(
			directory.path
		);
		const tools = ToolchainSetup.of(async () =>
			ToolchainSetup.stateOf(
				directory.path,
				manifests,
				await this.existingFolder(directory.path),
				{
					finder: this.finder,
					locator: this.locator,
				}
			)
		);
		return this.planWith(directory, questions, [
			new ProjectSetup(directory, questions, this.fileSystemService),
			agents.value,
			tools,
		]);
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
		setups: readonly Setup<unknown>[]
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

	refreshAgentRules(folder: string): Promise<string[]> {
		return new AgentRules(this.fileSystemService).refresh(folder);
	}

	write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun = false
	): Promise<Result<void, Error>> {
		return this.writer.write(plan, onWritten, dryRun);
	}
}
