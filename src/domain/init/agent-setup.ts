import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { AgentFile } from "./agent-file.js";
import { AgentHooks } from "./agent-hooks.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { Setup } from "./setup.js";

/** What `init` adds for coding agents. */
export interface AgentChoices {
	/** Rogen's rules, in the repo's agent file. */
	readonly rules: boolean;
	/** The hook that reports Rogen warnings, registered with each agent in use. */
	readonly hook: boolean;
}

/** Rogen's rules for coding agents and the hook that reports warnings, each asked for unless it is there already. */
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
		if (rules) builder.addAgentFile(this.agentFile);
		if (hook) builder.addAgentHook(this.hooks);
		for (const note of this.hooks.notes) builder.addNote(note);
	}
}
