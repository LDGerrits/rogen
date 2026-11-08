import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { WriteRun } from "../write/write.js";

export interface SyncbackRequest {
	readonly selection: ConfigSelection;
	/** The project whose files take the changes; its project file is written. */
	readonly project: ResolvedConfig;
	/** The place or model file Rojo reads, as given. */
	readonly input: string;
	/** Where Rojo runs, so `input` is relative to it. */
	readonly cwd: string;
}

/** A file or folder syncback writes or removes. */
export interface SyncbackChange {
	readonly kind: "write" | "remove";
	/** Absolute, in the system's own form. */
	readonly file: string;
}

/** An instance of the place that no folder of the project can take, which syncback leaves out and says so. */
export interface UnplacedInstance {
	readonly instance: string;
	readonly reason: string;
}

export interface SyncbackPlan {
	readonly project: ResolvedConfig;
	/** What a run would write and remove, the new files at the place routing puts them. */
	readonly changes: readonly SyncbackChange[];
	/** What `--list` prints: the files and folders Rojo lists, in the order it lists them, with the files syncback placed after them. */
	readonly listed: readonly SyncbackChange[];
	readonly unplaced: readonly UnplacedInstance[];
	readonly compiled: readonly CompiledChange[];
}

export interface SyncbackResult extends SyncbackPlan {
	/** What a write raises about the files syncback placed: one that lands elsewhere than the place had it. */
	readonly warnings: readonly Diagnostic[];
}

/** How a run treats its plan: lists it only, writes it at once, or writes it once `confirm` says yes, which is asked only when the plan changes something. */
export type SyncbackMode =
	| "dryRun"
	| "apply"
	| { readonly confirm: (plan: SyncbackPlan) => Promise<boolean> };

export interface SyncbackOptions {
	/** The place or model file Rojo reads, as given. */
	readonly input: string;
	/** Where Rojo runs, so `input` is relative to it. */
	readonly cwd: string;
	readonly mode: SyncbackMode;
}

export type SyncbackOutcome =
	| { readonly kind: "notRun" }
	| {
			readonly kind: "failed";
			readonly error: Error;
			/** The config Rojo ran on. */
			readonly configFile: string;
	  }
	| {
			/** `planned` by a dry run, `declined` when nothing was written after the plan, `written` when it was. */
			readonly kind: "planned" | "declined" | "written";
			readonly plan: SyncbackPlan;
			readonly warnings: readonly Diagnostic[];
			/** Whether `confirm` was shown the plan. */
			readonly asked: boolean;
	  };

/** What a syncback did: to the project file, and to the source files. */
export interface SyncbackRun {
	readonly write: WriteRun;
	readonly outcome: SyncbackOutcome;
}

/** A name that is a place or model file, not a project. */
const PLACE_FILE = /\.rbxlx?$|\.rbxmx?$/i;

/** The first of `names` that is a place or model file, which a project argument is not. */
export function placeFileAmong(names: readonly string[]): string | undefined {
	return names.find((name) => PLACE_FILE.test(name));
}

/** A change in the place to code the project compiles, which syncback leaves out since the next compile replaces it. */
export interface CompiledChange {
	readonly instance: string;
	readonly kind: "changed" | "removed" | "added";
}
