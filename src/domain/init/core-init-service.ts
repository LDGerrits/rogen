import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { ConfigService } from "../config/config-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { CodeFinder } from "./code-finder.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { AgentReader } from "./agent-reader.js";
import { InitWriter } from "./init-writer.js";
import { AgentSetup } from "./agent-setup.js";
import { GitIgnore } from "./git-ignore.js";
import { GitIgnoreSetup } from "./git-ignore-setup.js";
import {
	InitOptions,
	InitPlan,
	InitService,
	InitWritten,
} from "./init-service.js";
import { InitAdditions } from "./init-additions.js";
import { Setup } from "./setup.js";
import { ProjectSetup } from "./project-setup.js";

export class CoreInitService implements InitService {
	declare readonly _serviceBrand: undefined;

	private readonly agentReader: AgentReader;
	private readonly writer: InitWriter;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly promptService: PromptService,
		private readonly environmentService: EnvironmentService,
		private readonly toolchainService: ToolchainService,
		private readonly configService: ConfigService
	) {
		this.agentReader = new AgentReader(fileSystemService);
		this.writer = new InitWriter(fileSystemService);
	}

	async plan({ ask = true }: InitOptions = {}): Promise<
		Result<InitPlan | undefined, Error>
	> {
		const directory = await this.prepare();
		if (directory.isErr()) return directory;
		const interactive = ask && this.promptService.isInteractive;
		const questions = new InitQuestions(this.promptService, interactive);
		const nested = await this.checkNested(directory.value, questions);
		if (nested.isErr() || nested.value === "cancelled")
			return nested.map(() => undefined);
		return this.planIn(directory.value, questions);
	}

	/** A run that can't ask refuses to start a project below a config. */
	private async checkNested(
		directory: InitDirectory,
		questions: InitQuestions
	): Promise<Result<"go" | "cancelled", Error>> {
		if (directory.hasConfigs) return ok("go");
		const enclosing = await this.configService.findEnclosing();
		if (!enclosing) return ok("go");
		const answer = await questions.startNestedProject(enclosing);
		if (answer === undefined) return ok("cancelled");
		if (answer) return ok("go");
		if (questions.interactive) return ok("cancelled");
		return err(
			new Error(
				`${enclosing.directory} already has ${enclosing.fileNames.join(", ")}, so this folder may already be part of that project. ` +
					`To use that project, run rogen from there: cd ${enclosing.directory}. ` +
					`To start a separate project here anyway, run rogen init without --non-interactive in a terminal.`
			)
		);
	}

	private async prepare(): Promise<Result<InitDirectory, Error>> {
		const directory = this.environmentService.cwd;
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(directory)
		);
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
		// A first init starts a project; beside a config, the user says what to add.
		if (!directory.hasConfigs) {
			const { gitIgnore, inRepo } = await GitIgnore.read(
				this.fileSystemService,
				directory.path
			);
			return this.planWith(
				directory,
				questions,
				new ProjectSetup(directory, questions, this.fileSystemService),
				new GitIgnoreSetup(gitIgnore, inRepo, questions),
				agents
			);
		}
		const options = new InitAdditions(
			questions,
			agentFile.value,
			hooks.value
		).options();
		if (options.length === 0)
			return err(
				new DiagnosticsError(directory.checkFree(directory.configFiles))
			);
		const addition = await questions.whatToAdd(
			directory.configFiles[0],
			options
		);
		if (addition === undefined) return ok(undefined);
		return this.planWith(directory, questions, addition);
	}

	/** Asks each setup its questions in turn, then plans what the answers write. */
	private async planWith(
		directory: InitDirectory,
		questions: InitQuestions,
		...setups: readonly Setup<unknown>[]
	): Promise<Result<InitPlan | undefined, Error>> {
		const answered: { setup: Setup<unknown>; choices: unknown }[] = [];
		for (const setup of setups) {
			const asked = await setup.ask();
			if (asked.isErr()) return err(new DiagnosticsError(asked.error));
			if (asked.value === undefined) return ok(undefined);
			answered.push({ setup, choices: asked.value });
		}

		const builder = new InitPlanBuilder(directory, questions.interactive);
		for (const { setup, choices } of answered) setup.plan(choices, builder);
		const plan = builder.build();
		return plan.isErr() ? err(new DiagnosticsError(plan.error)) : plan;
	}

	write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void
	): Promise<Result<void, Error>> {
		return this.writer.write(plan, onWritten);
	}
}
