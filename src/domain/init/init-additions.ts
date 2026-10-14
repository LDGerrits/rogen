import { joinedWithAnd } from "../../base/strings.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import { AgentSetup } from "./agent-setup.js";
import { AdditionOption, InitQuestions } from "./init-questions.js";
import { InitChoices } from "./init-service.js";
import { RojoPinSetup } from "./rojo-pin-setup.js";
import { AnsweredSetup, Setup } from "./setup.js";

export class InitAdditions {
	constructor(
		private readonly questions: InitQuestions,
		private readonly agentFile: AgentFile,
		private readonly hooks: AgentHooks,
		private readonly rojoPin?: RojoPinSetup
	) {}

	/** What the flags ask to add, or `undefined` when they ask for nothing. */
	requested(choices: InitChoices): Setup<unknown>[] | undefined {
		const { questions, agentFile, hooks, rojoPin } = this;
		const rules = choices.agentRules === true && !agentFile.hasBlock;
		const hook = choices.agentHook === true;
		const pin = choices.rojoPin === true;
		if (choices.agentRules !== true && !hook && !pin) return undefined;
		return [
			...(rules || hook
				? [
						new AnsweredSetup(
							new AgentSetup(agentFile, hooks, questions),
							{ rules, hook }
						),
					]
				: []),
			...(pin && rojoPin ? [new AnsweredSetup(rojoPin, true)] : []),
		];
	}

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
							flag: "--agent-rules",
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
							flag: "--agent-hook",
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
							flag: "--rojo-pin",
							label: "Rojo pin",
							hint: "pins Rojo in your toolchain file",
							addition: new AnsweredSetup(rojoPin, true),
						},
					]
				: []),
		];
	}
}
