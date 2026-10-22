import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

/** One kind of thing `init` can add: it asks what it needs, then says what those answers write. */
export interface Setup<C> {
	/** `ok(undefined)` when the user cancelled. */
	ask(): Promise<Result<C | undefined, Diagnostic[]>>;
	plan(choices: C, builder: InitPlanBuilder): void;
}
