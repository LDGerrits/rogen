import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { Setup } from "./setup.js";

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
				this.hooks.usesClaudeCode && !this.agentFile.hasClaudeFile
			);
		if (hook) builder.addAgentHook(this.hooks);
		builder.addSummary(
			"Agents",
			[
				...(rules || this.agentFile.hasBlock
					? [`rules in ${this.agentFile.blockFileName}`]
					: []),
				...(hook ? [`hook for ${this.hooks.agents.join(", ")}`] : []),
			].join(", ") || "none"
		);
		for (const note of this.hooks.notes) builder.addNote(note);
	}
}
