import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { DetectedWorkspace } from "../toolchain/toolchain.js";
import { InitPlan } from "./init-plan.js";

export type { InitPlan, NextSteps, PlannedFile } from "./init-plan.js";

/** What `init` found in the directory it runs in, ready to plan from. */
export interface InitRequest {
	/** The absolute directory init writes into. */
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
	readonly workspace: DetectedWorkspace;
	/** The config name given on the command line, if one was. */
	readonly givenName?: string;
	/** The name written when none is asked for: the given one, else `default`. */
	readonly name: string;
}

/** Writes a starter config into the working directory in three steps, so a caller can print between them. */
export interface InitService {
	readonly _serviceBrand: undefined;

	/** Checks the names given after `init` and reads the directory's entries and toolchain; asks and writes nothing. */
	prepare(names: readonly string[]): Promise<Result<InitRequest, Error>>;

	/** Decides everything `init` writes and says; `ok(undefined)` means the user cancelled. */
	plan(
		request: InitRequest
	): Promise<Result<InitPlan | undefined, Diagnostic[]>>;

	/** Writes the plan's files, calling `onWritten` after each and stopping at the first that fails. */
	write(
		request: InitRequest,
		plan: InitPlan,
		onWritten: (fileName: string) => void
	): Promise<Result<void, Error>>;
}

export const InitService = createServiceIdentifier<InitService>("initService");
