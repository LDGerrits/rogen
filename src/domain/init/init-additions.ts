import { joinedWithAnd } from "../../base/strings.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import { AgentSetup } from "./agent-setup.js";
import { AdditionOption, InitQuestions } from "./init-questions.js";
import { AnsweredSetup, Setup } from "./setup.js";

/** What can be added beside the config here, and what adding each asks and writes. */
export class InitAdditions {
	constructor(
		private readonly questions: InitQuestions,
		private readonly agentFile: AgentFile,
		private readonly hooks: AgentHooks
	) {}

	/** The agent rules until they are there; the hook where an agent is in use, unless the run can't ask, since it edits the repo's tooling. */
	options(): AdditionOption<Setup<unknown>>[] {
		const { questions, agentFile, hooks } = this;
		const agents = new AgentSetup(agentFile, hooks, questions);
		return [
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
			...(hooks.agents.length > 0 && questions.interactive
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
