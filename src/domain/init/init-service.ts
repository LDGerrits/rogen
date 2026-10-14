import { Result } from "../../base/result.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { PlannedFile } from "../toolchain/toolchain.js";

export interface NextSteps {
	readonly setup: readonly string[];
	readonly run: readonly string[];
	readonly darklua: readonly string[];
	readonly edits: readonly string[];
}

export interface InitPlan {
	readonly directory: string;
	readonly files: readonly PlannedFile[];
	/** Relative to `directory`; created by `init` when missing. */
	readonly directories: readonly string[];
	readonly configs: readonly string[];
	readonly notes: readonly string[];
	readonly nextSteps: NextSteps;
	readonly asked: boolean;
}

export type InitWritten =
	| { readonly kind: "file"; readonly file: PlannedFile }
	| { readonly kind: "directory"; readonly directory: string };

export interface InitOptions {
	readonly ask?: boolean;
	readonly place?: string;
}

/** Writes a starter `rogen.json` in two steps, so a caller can print between them. */
export interface InitService {
	readonly _serviceBrand: undefined;

	/** `ok(undefined)` means the user cancelled; with `ask` false it takes every default. */
	plan(options?: InitOptions): Promise<Result<InitPlan | undefined, Error>>;

	/** A directory that exists is left alone and not reported. */
	write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void
	): Promise<Result<void, Error>>;
}

export const InitService = createServiceIdentifier<InitService>("initService");
