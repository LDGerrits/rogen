import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

/** One kind of thing `init` can add: it asks what it needs, then says what those answers write. */
export interface Setup<C> {
	/** Asks its questions; `ok(undefined)` when the user cancelled. Fails when a file it would write already exists. */
	ask(): Promise<Result<C | undefined, Diagnostic[]>>;
	/** Adds what `choices` write and say. */
	plan(choices: C, builder: InitPlanBuilder): void;
}

/** A setup whose questions were answered before it was chosen, such as an addition picked from What to add: the pick is the yes, so there is nothing left to ask. */
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
