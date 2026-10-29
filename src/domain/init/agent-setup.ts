import { Result, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import {
	CLAUDE_SETTINGS_FILE,
	GEMINI_SETTINGS_FILE,
} from "./agent/coding-agent.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { Setup } from "./setup.js";

/** The agents that read a file of their own in place of `AGENTS.md`. */
const OWN_FILES = [
	{ fileName: "CLAUDE.md", settingsFile: CLAUDE_SETTINGS_FILE },
	{ fileName: "GEMINI.md", settingsFile: GEMINI_SETTINGS_FILE },
] as const;

interface AgentChoices {
	readonly rules: boolean;
	readonly hook: boolean;
}

export class AgentSetup implements Setup<AgentChoices> {
	constructor(
		private readonly agentFile: AgentFile,
		private readonly hooks: AgentHooks,
		private readonly questions: InitQuestions
	) {}

	async ask(): Promise<Result<AgentChoices | undefined, Diagnostic[]>> {
		const rules = this.agentFile.hasBlock
			? false
			: await this.questions.addAgentInstructions(
					this.agentFile.fileName
				);
		if (rules === undefined) return ok(undefined);
		const hook = this.hooks.offered
			? await this.questions.addAgentHook(this.hooks.agents)
			: false;
		if (hook === undefined) return ok(undefined);
		return ok({ rules, hook });
	}

	plan({ rules, hook }: AgentChoices, builder: InitPlanBuilder): void {
		if (rules)
			builder.addAgentFile(
				this.agentFile,
				this.agentFile.imports(
					OWN_FILES.filter(({ settingsFile }) =>
						this.hooks.uses(settingsFile)
					).map(({ fileName }) => fileName)
				)
			);
		if (hook) builder.addAgentHook(this.hooks);
		else if (this.hooks.offered)
			builder.addEdit(
				`To have ${joinedWithAnd(this.hooks.agents)} report Rogen's warnings when ${this.hooks.agents.length === 1 ? "it ends its turn" : "they end their turn"}, run 'rogen init --agent-hook'.`
			);
		builder.addSummary(
			"Agents",
			[
				...(rules || this.agentFile.hasBlock
					? [`rules in ${this.agentFile.blockFileName}`]
					: []),
				...(hook ? [`hook for ${this.hooks.agents.join(", ")}`] : []),
			].join(", ") || "none"
		);
		if (this.agentFile.hasBlock && this.questions.choices.agentRules)
			builder.addNote(
				`Rogen's rules are in ${this.agentFile.blockFileName} already. A 'rogen write' keeps them current.`
			);
		const { registered } = this.hooks;
		if (this.questions.choices.agentHook && registered.length > 0)
			builder.addNote(
				`The Rogen hook is registered for ${joinedWithAnd(registered)} already.`
			);
		for (const note of this.hooks.notes) builder.addNote(note);
	}
}
