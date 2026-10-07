import { Result } from "../../base/result.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { PlannedFile } from "../toolchain/toolchain.js";

/** What to do after `init`, grouped by how it is done. */
export interface NextSteps {
	/** One-time edits before anything runs. */
	readonly setup: readonly string[];
	/** Long-running commands, one terminal each. */
	readonly run: readonly string[];
	/** Commands that have Darklua process the code into the sync dir. */
	readonly darklua: readonly string[];
	/** Pointers to what to change in the written files. */
	readonly edits: readonly string[];
}

/** Everything `init` writes and says, decided before anything is written. */
export interface InitPlan {
	/** The absolute directory the files go into. */
	readonly directory: string;
	/** In the order they are written. */
	readonly files: readonly PlannedFile[];
	/** Lines printed before the files are written. */
	readonly notes: readonly string[];
	readonly nextSteps: NextSteps;
}

export interface InitOptions {
	/** Whether `init` may ask at all; it asks only in a terminal a person can answer. */
	readonly ask?: boolean;
}

/** Writes a starter config into the working directory in two steps, so a caller can print between them. */
export interface InitService {
	readonly _serviceBrand: undefined;

	/** Asks what to write and writes nothing; `ok(undefined)` means the user cancelled. With `ask` false it takes every default, as a run without a terminal does. */
	plan(
		names: readonly string[],
		options?: InitOptions
	): Promise<Result<InitPlan | undefined, Error>>;

	/** Writes the plan's files, calling `onWritten` after each and stopping at the first that fails. */
	write(
		plan: InitPlan,
		onWritten: (file: PlannedFile) => void
	): Promise<Result<void, Error>>;
}

export const InitService = createServiceIdentifier<InitService>("initService");
