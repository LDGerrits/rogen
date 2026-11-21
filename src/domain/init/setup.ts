import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

export interface Setup<C> {
	ask(): Promise<Result<C | undefined, Diagnostic[]>>;
	plan(choices: C, builder: InitPlanBuilder): void;
}
