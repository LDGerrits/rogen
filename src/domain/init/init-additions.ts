import path from "path";
import { toPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import { AgentSetup } from "./agent-setup.js";
import { PresentItem } from "./init-service.js";
import { AdditionOption, InitQuestions } from "./init-questions.js";
import { RojoPinSetup } from "./rojo-pin-setup.js";
import { AnsweredSetup, Setup } from "./setup.js";

export class InitAdditions {
	constructor(
		private readonly questions: InitQuestions,
		private readonly agentFile: AgentFile,
		private readonly hooks: AgentHooks,
		private readonly rojoPin: RojoPinSetup | undefined,
		/** The toolchain file that pins Rojo already, if one does. */
		private readonly pinnedIn: string | undefined,
		/** The folder the files of the additions are named from. */
		private readonly directory: string
	) {}

	/** What the project has of the additions, as `only` asks (all of them when it is not given). */
	present(only?: ReadonlySet<PresentItem["item"]>): PresentItem[] {
		const { agentFile, hooks, pinnedIn, directory } = this;
		const wanted = (item: PresentItem["item"]) => !only || only.has(item);
		return [
			...(agentFile.hasBlock && wanted("agentRules")
				? [
						{
							item: "agentRules" as const,
							file: agentFile.blockFileName,
						},
					]
				: []),
			...(wanted("agentHook")
				? hooks.registeredIn.map((file) => ({
						item: "agentHook" as const,
						file,
					}))
				: []),
			...(pinnedIn && wanted("rojoPin")
				? [
						{
							item: "rojoPin" as const,
							file: toPosix(path.relative(directory, pinnedIn)),
						},
					]
				: []),
		];
	}

	/** What the flags ask for that the project has already. */
	presentAsked(): PresentItem[] {
		const { choices } = this.questions;
		return this.present(
			new Set([
				...(choices.agentRules === true ? ["agentRules" as const] : []),
				...(choices.agentHook === true ? ["agentHook" as const] : []),
				...(choices.rojoPin === true ? ["rojoPin" as const] : []),
			])
		);
	}

	/** What the flags ask to add, or `undefined` when they ask for nothing. What is already there is not added again. */
	requested(): Setup<unknown>[] | undefined {
		const { questions, agentFile, hooks, rojoPin } = this;
		const { choices } = questions;
		const rules = choices.agentRules === true && !agentFile.hasBlock;
		const hook = choices.agentHook === true && hooks.offered;
		const pin = choices.rojoPin === true;
		if (choices.agentRules !== true && choices.agentHook !== true && !pin)
			return undefined;
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
		const { choices } = questions;
		const agents = new AgentSetup(agentFile, hooks, questions);
		const options: AdditionOption<Setup<unknown>>[] = [
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
		const refused = new Set([
			...(choices.agentRules === false ? ["agent"] : []),
			...(choices.agentHook === false ? ["hook"] : []),
			...(choices.rojoPin === false ? ["rojo"] : []),
		]);
		return options.filter(({ id }) => !refused.has(id));
	}
}
