import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { AgentFile } from "./agent-file.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";

/** Adds Rogen's rules for coding agents to the repo's agent file, unless it already holds them. */
export class AgentSetup implements Setup<boolean> {
	constructor(
		private readonly agentFile: AgentFile,
		private readonly questions: InitQuestions,
		/** Picked from What to add, which is the yes. */
		private readonly chosen = false
	) {}

	async ask(): Promise<Result<boolean | undefined, Diagnostic[]>> {
		if (this.agentFile.hasBlock) return ok(false);
		if (this.chosen) return ok(true);
		return ok(
			await this.questions.addAgentInstructions(this.agentFile.fileName)
		);
	}

	plan(add: boolean, builder: InitPlanBuilder): void {
		if (add) builder.addAgentFile(this.agentFile);
	}
}
