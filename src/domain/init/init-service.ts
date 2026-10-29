import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { PlannedFile } from "../toolchain/toolchain.js";

export interface NextSteps {
	/** The folder `init` set up, relative to the one it ran in, which every step runs from; left out when that is the same folder. */
	readonly directory?: string;
	readonly setup: readonly string[];
	readonly run: readonly string[];
	readonly edits: readonly string[];
}

/** The template of a new project, as `rojo init --kind` names it. */
export type InitKind = "place" | "model" | "plugin";

/** What the user gave as flags, so that `init` asks nothing about it. */
export interface InitChoices {
	readonly kind?: InitKind;
	readonly skipGit?: boolean;
	readonly agentRules?: boolean;
	readonly agentHook?: boolean;
	readonly language?: string;
	readonly sourcePaths?: readonly string[];
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

/** A program that `init` runs once it has written the files, such as the tool that installs a compiler's packages. */
export interface PlannedCommand {
	/** The command line as a person types it. */
	readonly command: string;
	/** The program, looked for on the PATH and in Rokit's bin folder when it runs. */
	readonly file: string;
	readonly args: readonly string[];
	/** How long it may run, in milliseconds. */
	readonly timeout: number;
}

/** A tool that writes the project's own files before `init` adds its own, such as the create tool of a compiler. */
export interface PlannedScaffold {
	readonly command: PlannedCommand;
	/** Relative to the plan's directory: what the tool writes that `init` replaces, removed once the tool has run. */
	readonly replaces: readonly string[];
}

/** One line of the summary a run shows before it writes: an area of the project and what it gets. */
export interface SummaryRow {
	readonly area: string;
	readonly text: string;
}

export interface InitPlan {
	readonly directory: string;
	/** What the plan sets up, by area, which the summary shows beside the files and commands. */
	readonly summary: readonly SummaryRow[];
	/** Runs before any file is written; a failure writes nothing. */
	readonly scaffold?: PlannedScaffold;
	readonly files: readonly PlannedFile[];
	/** Relative to `directory`; created by `init` when missing. */
	readonly directories: readonly string[];
	/** Run in this order, in `directory`, after the files are written; the first to fail stops the rest. */
	readonly commands: readonly PlannedCommand[];
	readonly configs: readonly string[];
	readonly notes: readonly string[];
	/** What `init` could not do as asked, such as settings of a lifted file it had to leave out. */
	readonly warnings: readonly Diagnostic[];
	/** The project file whose tree went into the config, which init leaves in place. */
	readonly liftedFrom?: string;
	readonly nextSteps: NextSteps;
	readonly asked: boolean;
	readonly decided: readonly InitDecision[];
	/** Whether `init` runs `git init` in `directory`, which it does in a new project that no work tree holds. */
	readonly gitInit: boolean;
}

export type InitWritten =
	| { readonly kind: "scaffold"; readonly scaffold: PlannedScaffold }
	| { readonly kind: "file"; readonly file: PlannedFile }
	| { readonly kind: "directory"; readonly directory: string }
	/** `failed` is why `git init` did not make a repository, which leaves the project complete without one. */
	| { readonly kind: "git"; readonly failed?: string }
	/** `failed` is why it did not finish, and `skipped` the commands after it that did not run. */
	| {
			readonly kind: "command";
			readonly command: PlannedCommand;
			readonly failed?: string;
			readonly skipped?: readonly PlannedCommand[];
	  };

export interface InitOptions {
	readonly ask?: boolean;
	readonly place?: string;
	readonly choices?: InitChoices;
}

/** Writes a starter `default.rogen.json` in two steps, so a caller can print between them. */
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

	/** Brings the Rogen block of the agent files of `folder`, and of the folders above it up to the repository root, to this version's, and returns the files it rewrote. A file without the block is never touched. */
	refreshAgentRules(folder: string): Promise<string[]>;
}

export const InitService = createServiceIdentifier<InitService>("initService");
