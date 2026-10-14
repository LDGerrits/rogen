import { Result } from "../../base/result.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { PlannedFile } from "../toolchain/toolchain.js";

export interface NextSteps {
	readonly setup: readonly string[];
	readonly run: readonly string[];
	readonly darklua: readonly string[];
	readonly edits: readonly string[];
}

/** What the user gave as flags, so that `init` asks nothing about it. */
export interface InitChoices {
	readonly nested?: boolean;
	readonly placeListing?: "glob" | "folder";
	readonly agentRules?: boolean;
	readonly rojoPin?: boolean;
	readonly agentHook?: boolean;
	readonly language?: string;
	readonly darklua?: boolean;
	readonly sourcePaths?: readonly string[];
	readonly projectFile?: "lift" | "new";
	readonly syncPath?: string;
	/** Folders to mount, or `none`. */
	readonly packages?: readonly string[];
	/** Route ids, or `none`. */
	readonly routes?: readonly string[];
	readonly unmatched?: "shared" | "leave";
}

/** A choice a run that couldn't ask took for itself, and the flag that makes it another. */
export interface InitDecision {
	readonly question: string;
	readonly value: string | boolean | readonly string[];
	readonly flag: string;
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
	readonly decided: readonly InitDecision[];
}

export type InitWritten =
	| { readonly kind: "file"; readonly file: PlannedFile }
	| { readonly kind: "directory"; readonly directory: string };

export interface InitOptions {
	readonly ask?: boolean;
	readonly place?: string;
	readonly choices?: InitChoices;
}

/** Writes a starter `rogen.json` in two steps, so a caller can print between them. */
export interface InitService {
	readonly _serviceBrand: undefined;

	/** `ok(undefined)` means the user cancelled; with `ask` false it takes every default. */
	plan(options?: InitOptions): Promise<Result<InitPlan | undefined, Error>>;

	/** A directory that exists is left alone and not reported. A dry run writes nothing, and reports what it would. */
	write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun?: boolean
	): Promise<Result<void, Error>>;
}

export const InitService = createServiceIdentifier<InitService>("initService");
