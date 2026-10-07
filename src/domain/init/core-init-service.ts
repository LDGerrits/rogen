import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { DEFAULT_CONFIG_STEM, configFileName } from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { AgentFile } from "./agent-file.js";
import { AgentSetup } from "./agent-setup.js";
import { InitOptions, InitPlan, InitService } from "./init-service.js";
import { BaseConfigReader } from "./base-config-reader.js";
import { PlaceSetup } from "./place-setup.js";
import { ProjectSetup } from "./project-setup.js";
import { ExtendingConfigSetup } from "./extending-config-setup.js";

export class CoreInitService implements InitService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly promptService: PromptService,
		private readonly environmentService: EnvironmentService,
		private readonly toolchainService: ToolchainService,
		private readonly configService: ConfigService
	) {}

	async plan(
		names: readonly string[],
		{ ask = true }: InitOptions = {}
	): Promise<Result<InitPlan | undefined, Error>> {
		const directory = await this.prepare(names);
		if (directory.isErr()) return directory;
		const interactive = ask && this.promptService.isInteractive;
		return this.planIn(
			directory.value,
			new InitQuestions(this.promptService, interactive)
		);
	}

	private async prepare(
		names: readonly string[]
	): Promise<Result<InitDirectory, Error>> {
		const name = ConfigSet.parseName(names);
		if (name.isErr()) return name;

		const directory = this.environmentService.cwd;
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(directory)
		);
		if (listing.isErr()) {
			return err(
				new Error(
					`Failed to read ${directory}: ${listing.error.message}`,
					{ cause: listing.error }
				)
			);
		}
		const entries = new Set(listing.value.map(([entry]) => entry));
		const base = entries.has(configFileName(DEFAULT_CONFIG_STEM))
			? await new BaseConfigReader(this.configService, directory).read(
					entries
				)
			: undefined;

		return ok(
			new InitDirectory(
				directory,
				entries,
				await this.toolchainService.detect(directory),
				names.length > 0 ? name.value : undefined,
				name.value,
				base
			)
		);
	}

	private async planIn(
		directory: InitDirectory,
		questions: InitQuestions
	): Promise<Result<InitPlan | undefined, Error>> {
		// A run that can't ask never gets to pick another name, so the one it has must be free.
		const knownName =
			directory.givenName ??
			(questions.interactive ? undefined : directory.name);
		const unnamed = questions.interactive
			? []
			: directory.checkPlaceNamed();
		if (unnamed.length > 0) return err(new DiagnosticsError(unnamed));
		const taken = directory.checkFree(
			knownName ? [configFileName(knownName)] : []
		);
		if (taken.length > 0) return err(new DiagnosticsError(taken));

		// A new project when there is no `default.rogen.json` yet, otherwise what the user says to add beside it.
		const projectSetup = new ProjectSetup(
			directory,
			questions,
			this.fileSystemService
		);
		const agentFile = await this.agentFileIn(directory);
		if (!directory.hasDefaultConfig)
			return directory.hasConfigs
				? this.planWith(directory, projectSetup)
				: this.planWith(
						directory,
						projectSetup,
						new AgentSetup(agentFile, questions)
					);
		const offered = agentFile.hasBlock ? undefined : agentFile.fileName;
		switch (await questions.whatToAdd(offered)) {
			case undefined:
				return ok(undefined);
			case "place":
				return this.planWith(
					directory,
					new PlaceSetup(directory, questions)
				);
			case "extending":
				return this.planWith(
					directory,
					new ExtendingConfigSetup(directory, questions)
				);
			case "separate":
				return this.planWith(directory, projectSetup);
			case "agent":
				return this.planWith(
					directory,
					new AgentSetup(agentFile, questions, true)
				);
		}
	}

	/** Asks each setup its questions in turn, then plans what the answers write. */
	private async planWith(
		directory: InitDirectory,
		...setups: readonly Setup<unknown>[]
	): Promise<Result<InitPlan | undefined, Error>> {
		const answers: unknown[] = [];
		for (const setup of setups) {
			const asked = await setup.ask();
			if (asked.isErr()) return err(new DiagnosticsError(asked.error));
			if (asked.value === undefined) return ok(undefined);
			answers.push(asked.value);
		}

		const builder = new InitPlanBuilder(directory);
		setups.forEach((setup, index) => setup.plan(answers[index], builder));
		const plan = builder.build();
		return plan.isErr() ? err(new DiagnosticsError(plan.error)) : plan;
	}

	/** The agent file the repo has, read so `init` can tell whether it already holds Rogen's rules. */
	private async agentFileIn(directory: InitDirectory): Promise<AgentFile> {
		const [agents, claude] = await Promise.all(
			AgentFile.FILE_NAMES.map(async (fileName) => {
				if (!directory.has(fileName)) return undefined;
				const text = await tryWithAsync(() =>
					this.fileSystemService.readFile(
						path.join(directory.path, fileName)
					)
				);
				return text.isOk() ? text.value : undefined;
			})
		);
		return AgentFile.choose(agents, claude);
	}

	async write(
		plan: InitPlan,
		onWritten: (file: PlannedFile) => void
	): Promise<Result<void, Error>> {
		for (const file of plan.files) {
			const { fileName, content } = file;
			const written = await tryWithAsync(() =>
				this.fileSystemService.writeFile(
					path.join(plan.directory, fileName),
					content
				)
			);
			if (written.isErr()) {
				return err(
					new Error(
						`Failed to write ${fileName}: ${written.error.message}`,
						{ cause: written.error }
					)
				);
			}
			onWritten(file);
		}
		return ok(undefined);
	}
}
