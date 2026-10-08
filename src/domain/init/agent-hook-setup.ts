import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { AgentHooks } from "./agent-hooks.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";

/** Adds the hook that reports Rogen warnings to each agent in use, when the user wants it. */
export class AgentHookSetup implements Setup<boolean> {
	constructor(
		private readonly hooks: AgentHooks,
		private readonly questions: InitQuestions,
		/** Picked from What to add, which is the yes. */
		private readonly chosen = false
	) {}

	async ask(): Promise<Result<boolean | undefined, Diagnostic[]>> {
		if (!this.hooks.offered) return ok(false);
		if (this.chosen) return ok(true);
		return ok(await this.questions.addAgentHook(this.hooks.agents));
	}

	plan(add: boolean, builder: InitPlanBuilder): void {
		if (add) builder.addAgentHook(this.hooks);
	}
}
