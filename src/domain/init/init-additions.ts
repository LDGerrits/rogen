import { Result, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { AgentFile } from "./agent-file.js";
import { AgentHooks } from "./agent-hooks.js";
import { ExtendingConfigSetup } from "./extending-config-setup.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { AdditionOption, InitQuestions } from "./init-questions.js";
import { PlaceFolderReader } from "./place-folder.js";
import { PlaceSetup } from "./place-setup.js";
import { ProjectSetup } from "./project-setup.js";
import { Setup } from "./setup.js";

/** A setup's questions, whose answers come back bound to the setup that plans them; `undefined` when the user cancelled. */
export type Asking = () => Promise<
	Result<((builder: InitPlanBuilder) => void) | undefined, Diagnostic[]>
>;

/** An addition picked from What to add: the pick is the yes, so there is nothing left to ask. */
const chosen =
	(plan: (builder: InitPlanBuilder) => void): Asking =>
	async () =>
		ok(plan);

export function asking<C>(setup: Setup<C>): Asking {
	return async () =>
		(await setup.ask()).map((choices) =>
			choices === undefined
				? undefined
				: (builder: InitPlanBuilder) => setup.plan(choices, builder)
		);
}

/** What can be added beside the configs here, and what adding each asks and writes. */
export class InitAdditions {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		private readonly placeFolders: PlaceFolderReader,
		private readonly projectSetup: ProjectSetup,
		private readonly agentFile: AgentFile,
		private readonly hooks: AgentHooks
	) {}

	/** A place and an extending config only beside `default.rogen.json`; the agent rules until they are there; the hook where an agent is in use. */
	options(): AdditionOption<Asking>[] {
		const { directory, questions, agentFile, hooks } = this;
		const { base } = directory;
		return [
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
									this.placeFolders
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
				addition: asking(this.projectSetup),
			},
			...(agentFile.hasBlock
				? []
				: [
						{
							id: "agent",
							label: "Agent instructions",
							hint: `Rogen's rules for coding agents, in ${agentFile.fileName}`,
							addition: chosen((builder) =>
								builder.addAgentFile(agentFile)
							),
						},
					]),
			...(hooks.agents.length > 0
				? [
						{
							id: "hook",
							label: "Agent hook",
							hint: `reports Rogen warnings to ${joinedWithAnd(hooks.agents)}`,
							addition: chosen((builder) =>
								builder.addAgentHook(hooks)
							),
						},
					]
				: []),
		];
	}
}
