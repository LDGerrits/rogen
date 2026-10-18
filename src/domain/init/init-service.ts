import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { PlannedFile } from "../toolchain/toolchain.js";

export interface NextSteps {
	readonly setup: readonly string[];
	readonly run: readonly string[];
	readonly darklua: readonly string[];
	readonly edits: readonly string[];
}

/** The template of a new project, as `rojo init --kind` names it. */
export type InitKind = "place" | "model" | "plugin";

/** What the user gave as flags, so that `init` asks nothing about it. */
export interface InitChoices {
	readonly kind?: InitKind;
	readonly skipGit?: boolean;
	readonly nested?: boolean;
	readonly placeListing?: "glob" | "folder";
	/** Place IDs, or `none`. */
	readonly placeIds?: readonly string[];
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
	/** Whether a new place starts with the Greeter sample. */
	readonly sample?: boolean;
	/** Whether a new project is several places under `places/`, rather than one. */
	readonly places?: boolean;
}

/** A choice a run that couldn't ask took for itself, and the flag that makes it another. */
export interface InitDecision {
	readonly question: string;
	readonly value: string | boolean | readonly string[];
	readonly flag: string;
}

/** An addition the project has already, which init reports instead of adding again. */
export interface PresentItem {
	readonly item: "agentRules" | "agentHook" | "rojoPin";
	/** Relative to the plan's directory. */
	readonly file: string;
}

export interface InitPlan {
	readonly directory: string;
	readonly files: readonly PlannedFile[];
	/** Relative to `directory`; created by `init` when missing. */
	readonly directories: readonly string[];
	readonly configs: readonly string[];
	readonly notes: readonly string[];
	/** What `init` could not do as asked, such as settings of a lifted file it had to leave out. */
	readonly warnings: readonly Diagnostic[];
	/** The project file whose tree went into the config, which init leaves in place. */
	readonly liftedFrom?: string;
	readonly nextSteps: NextSteps;
	readonly asked: boolean;
	readonly decided: readonly InitDecision[];
	readonly present: readonly PresentItem[];
	/** Whether `init` runs `git init` in `directory`, which it does in a new project that no work tree holds. */
	readonly gitInit: boolean;
}

export type InitWritten =
	| { readonly kind: "file"; readonly file: PlannedFile }
	| { readonly kind: "directory"; readonly directory: string }
	/** `failed` is why `git init` did not make a repository, which leaves the project complete without one. */
	| { readonly kind: "git"; readonly failed?: string };

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
