import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

/** One kind of thing `init` can add: it asks what it needs, then says what those answers write. */
export interface Setup<C> {
	/** `ok(undefined)` when the user cancelled. */
	ask(): Promise<Result<C | undefined, Diagnostic[]>>;
	plan(choices: C, builder: InitPlanBuilder): void;
}

/** A setup whose answer was given by choosing it, so it asks nothing. */
export class AnsweredSetup<C> implements Setup<C> {
	constructor(
		private readonly setup: Setup<C>,
		private readonly choices: C
	) {}

	async ask(): Promise<Result<C | undefined, Diagnostic[]>> {
		return ok(this.choices);
	}

	plan(choices: C, builder: InitPlanBuilder): void {
		this.setup.plan(choices, builder);
	}
}
