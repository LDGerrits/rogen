import path from "path";
import { toNative } from "../../base/path.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";

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
}

export interface SyncbackResult extends SyncbackPlan {
	/** What a write raises about the files syncback placed: one that lands elsewhere than the place had it. */
	readonly warnings: readonly Diagnostic[];
}

/** A name that is a place or model file, not a project. */
const PLACE_FILE = /\.rbxlx?$|\.rbxmx?$/i;

/** The first of `names` that is a place or model file, which a project argument is not. */
export function placeFileAmong(names: readonly string[]): string | undefined {
	return names.find((name) => PLACE_FILE.test(name));
}

/** The error for a project that reads compiled code, which syncback would write into and the next compile would delete; `undefined` for any other project. */
export function compiledPathRefusal(
	project: ResolvedConfig
): DiagnosticsError | undefined {
	if (project.compiledPath === undefined) return undefined;
	const folder = toNative(
		path.relative(project.projectDir, project.compiledPath)
	);
	return new DiagnosticsError([
		errorDiagnostic(
			"syncback.compiledPath",
			{ resource: project.file },
			`the project reads compiled code from ${folder}; syncback would write into it and the next compile would delete the edits. Bring the changes into the source files by hand, or run syncback on a project that has no compiledPath.`
		),
	]);
}
