import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
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

/** A setup's questions, whose answers come back bound to the setup that plans them; `undefined` when the user cancelled. */
type Asking = () => Promise<
	Result<((builder: InitPlanBuilder) => void) | undefined, Diagnostic[]>
>;

function asking<C>(setup: Setup<C>): Asking {
	return async () =>
		(await setup.ask()).map((choices) =>
			choices === undefined
				? undefined
				: (builder: InitPlanBuilder) => setup.plan(choices, builder)
		);
}

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
		const { base } = directory;
		if (!base && directory.hasConfigs)
			return this.planWith(directory, questions, asking(projectSetup));
		const read = await this.agentFileIn(directory);
		if (read.isErr()) return read;
		const agentFile = read.value;
		if (!base)
			return this.planWith(
				directory,
				questions,
				asking(projectSetup),
				asking(new AgentSetup(agentFile, questions))
			);
		const offered = agentFile.hasBlock ? undefined : agentFile.fileName;
		switch (await questions.whatToAdd(offered)) {
			case undefined:
				return ok(undefined);
			case "place":
				return this.planWith(
					directory,
					questions,
					asking(new PlaceSetup(directory, base, questions))
				);
			case "extending":
				return this.planWith(
					directory,
					questions,
					asking(new ExtendingConfigSetup(directory, questions))
				);
			case "separate":
				return this.planWith(
					directory,
					questions,
					asking(projectSetup)
				);
			case "agent":
				return this.planWith(
					directory,
					questions,
					asking(new AgentSetup(agentFile, questions, true))
				);
		}
	}

	/** Asks each setup its questions in turn, then plans what the answers write. */
	private async planWith(
		directory: InitDirectory,
		questions: InitQuestions,
		...setups: readonly Asking[]
	): Promise<Result<InitPlan | undefined, Error>> {
		const plans: ((builder: InitPlanBuilder) => void)[] = [];
		for (const ask of setups) {
			const asked = await ask();
			if (asked.isErr()) return err(new DiagnosticsError(asked.error));
			if (asked.value === undefined) return ok(undefined);
			plans.push(asked.value);
		}

		const builder = new InitPlanBuilder(directory, questions.interactive);
		for (const plan of plans) plan(builder);
		const plan = builder.build();
		return plan.isErr() ? err(new DiagnosticsError(plan.error)) : plan;
	}

	/** Fails on a file it can't read rather than take it for missing, which would write over it. */
	private async agentFileIn(
		directory: InitDirectory
	): Promise<Result<AgentFile, Error>> {
		const texts: (string | undefined)[] = [];
		for (const fileName of AgentFile.FILE_NAMES) {
			if (!directory.has(fileName)) {
				texts.push(undefined);
				continue;
			}
			const text = await tryWithAsync(() =>
				this.fileSystemService.readFile(
					path.join(directory.path, fileName)
				)
			);
			if (text.isErr())
				return err(
					new Error(
						`Failed to read ${fileName}: ${text.error.message}`,
						{
							cause: text.error,
						}
					)
				);
			texts.push(text.value);
		}
		const [agents, claude] = texts;
		return ok(AgentFile.choose(agents, claude));
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
