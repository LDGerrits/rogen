import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { DEFAULT_CONFIG_FILE, configFileName } from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { AdditionOption, InitQuestions } from "./init-questions.js";
import { AgentReader } from "./agent-reader.js";
import { InitWriter } from "./init-writer.js";
import { AgentSetup } from "./agent-setup.js";
import {
	InitOptions,
	InitPlan,
	InitService,
	InitWritten,
} from "./init-service.js";
import { BaseConfigReader } from "./base-config-reader.js";
import { PlaceFolders } from "./place-folder.js";
import { PlaceSetup } from "./place-setup.js";
import { ProjectSetup } from "./project-setup.js";
import { ExtendingConfigSetup } from "./extending-config-setup.js";

/** A setup's questions, whose answers come back bound to the setup that plans them; `undefined` when the user cancelled. */
type Asking = () => Promise<
	Result<((builder: InitPlanBuilder) => void) | undefined, Diagnostic[]>
>;

/** An addition picked from What to add: the pick is the yes, so there is nothing left to ask. */
const chosen =
	(plan: (builder: InitPlanBuilder) => void): Asking =>
	async () =>
		ok(plan);

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

	async plan(
		names: readonly string[],
		{ ask = true }: InitOptions = {}
	): Promise<Result<InitPlan | undefined, Error>> {
		const directory = await this.prepare(names);
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
					`To add to it, run rogen from there: cd ${enclosing.directory} && rogen init <name>. ` +
					`To start a separate project here anyway, run rogen init without -y in a terminal.`
			)
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
				ErrorUtils.wrap(`Failed to read ${directory}`, listing.error)
			);
		}
		const entries = new Set(listing.value.map(([entry]) => entry));
		const base = entries.has(DEFAULT_CONFIG_FILE)
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

		const placeFolders = new PlaceFolders(
			this.fileSystemService,
			this.toolchainService
		);
		const projectSetup = new ProjectSetup(
			directory,
			questions,
			this.fileSystemService,
			placeFolders
		);
		const agentFile = await this.agentReader.fileIn(directory);
		if (agentFile.isErr()) return agentFile;
		const hooks = await this.agentReader.hooksIn(directory);
		if (hooks.isErr()) return hooks;
		// A first init starts a project; beside configs, the user says what to add.
		if (!directory.hasConfigs)
			return this.planWith(
				directory,
				questions,
				asking(projectSetup),
				asking(new AgentSetup(agentFile.value, hooks.value, questions))
			);
		const { base } = directory;
		const options: AdditionOption<Asking>[] = [
			...(base
				? [
						{
							id: "place",
							label: "A place",
							hint: "another Roblox place that shares default's code",
							addition: asking(
								new PlaceSetup(
									directory,
									base,
									questions,
									placeFolders
								)
							),
						},
						{
							id: "extending",
							label: "A config that extends default",
							hint: "the same game with other variants or excludes",
							addition: asking(
								new ExtendingConfigSetup(directory, questions)
							),
						},
					]
				: []),
			{
				id: "separate",
				label: "A separate config",
				hint: "answers every question again",
				addition: asking(projectSetup),
			},
			...(agentFile.value.hasBlock
				? []
				: [
						{
							id: "agent",
							label: "Agent instructions",
							hint: `Rogen's rules for coding agents, in ${agentFile.value.fileName}`,
							addition: chosen((builder) =>
								builder.addAgentFile(agentFile.value)
							),
						},
					]),
			...(hooks.value.agents.length > 0
				? [
						{
							id: "hook",
							label: "Agent hook",
							hint: `reports Rogen warnings to ${joinedWithAnd(hooks.value.agents)}`,
							addition: chosen((builder) =>
								builder.addAgentHook(hooks.value)
							),
						},
					]
				: []),
		];
		const addition = await questions.whatToAdd(base !== undefined, options);
		if (addition === undefined) return ok(undefined);
		return this.planWith(directory, questions, addition);
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

	write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void
	): Promise<Result<void, Error>> {
		return this.writer.write(plan, onWritten);
	}
}
