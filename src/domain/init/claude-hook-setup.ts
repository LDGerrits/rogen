import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ClaudeHook } from "./claude-hook.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";

/** Adds the Claude Code hook that reports Rogen warnings, where Claude Code is in use and the user wants it. */
export class ClaudeHookSetup implements Setup<boolean> {
	constructor(
		private readonly hook: ClaudeHook,
		private readonly questions: InitQuestions,
		/** Picked from What to add, which is the yes. */
		private readonly chosen = false
	) {}

	async ask(): Promise<Result<boolean | undefined, Diagnostic[]>> {
		if (!this.hook.offered) return ok(false);
		if (this.chosen) return ok(true);
		return ok(await this.questions.addClaudeHook());
	}

	plan(add: boolean, builder: InitPlanBuilder): void {
		if (add) builder.addClaudeHook(this.hook.files);
	}
}
