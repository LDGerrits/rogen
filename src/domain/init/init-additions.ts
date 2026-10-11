import { joinedWithAnd } from "../../base/strings.js";
import { AgentFile } from "./agent-file.js";
import { AgentHooks } from "./agent-hooks.js";
import { AgentSetup } from "./agent-setup.js";
import { ExtendingConfigSetup } from "./extending-config-setup.js";
import { InitDirectory } from "./init-directory.js";
import { AdditionOption, InitQuestions } from "./init-questions.js";
import { PlaceFolderReader } from "./place-folder.js";
import { PlaceSetup } from "./place-setup.js";
import { ProjectSetup } from "./project-setup.js";
import { AnsweredSetup, Setup } from "./setup.js";

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
	options(): AdditionOption<Setup<unknown>>[] {
		const { directory, questions, agentFile, hooks } = this;
		const { base } = directory;
		const agents = new AgentSetup(agentFile, hooks, questions);
		return [
			...(base
				? [
						{
							id: "place",
							label: "A place",
							hint: "another Roblox place that shares default's code",
							addition: new PlaceSetup(
								directory,
								base,
								questions,
								this.placeFolders
							),
						},
						{
							id: "extending",
							label: "A config that extends default",
							hint: "the same game with other variants or excludes",
							addition: new ExtendingConfigSetup(
								directory,
								questions
							),
						},
					]
				: []),
			{
				id: "separate",
				label: "A separate config",
				hint: "answers every question again",
				addition: this.projectSetup,
			},
			...(agentFile.hasBlock
				? []
				: [
						{
							id: "agent",
							label: "Agent instructions",
							hint: `Rogen's rules for coding agents, in ${agentFile.fileName}`,
							addition: new AnsweredSetup(agents, {
								rules: true,
								hook: false,
							}),
						},
					]),
			...(hooks.agents.length > 0
				? [
						{
							id: "hook",
							label: "Agent hook",
							hint: `reports Rogen warnings to ${joinedWithAnd(hooks.agents)}`,
							addition: new AnsweredSetup(agents, {
								rules: false,
								hook: true,
							}),
						},
					]
				: []),
		];
	}
}
