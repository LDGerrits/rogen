import { joinedWithAnd } from "../../base/strings.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import { AgentSetup } from "./agent-setup.js";
import { AdditionOption, InitQuestions } from "./init-questions.js";
import { RojoPinSetup } from "./rojo-pin-setup.js";
import { AnsweredSetup, Setup } from "./setup.js";

export class InitAdditions {
	constructor(
		private readonly questions: InitQuestions,
		private readonly agentFile: AgentFile,
		private readonly hooks: AgentHooks,
		private readonly rojoPin?: RojoPinSetup
	) {}

	/** The hook and the pin are not offered to a run that can't ask, since they edit the repo's tooling. */
	options(): AdditionOption<Setup<unknown>>[] {
		const { questions, agentFile, hooks, rojoPin } = this;
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
			...(rojoPin && questions.interactive
				? [
						{
							id: "rojo",
							label: "Rojo pin",
							hint: "pins Rojo in your toolchain file",
							addition: new AnsweredSetup(rojoPin, true),
						},
					]
				: []),
		];
	}
}
