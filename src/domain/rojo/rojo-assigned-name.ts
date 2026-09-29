import { stemOf } from "../../base/path.js";
import { RojoFileKind } from "./rojo-files.js";

const ROJO_SCRIPT_SUFFIXES = ["server", "client", "plugin"] as const;

export type RojoScriptSuffix = (typeof ROJO_SCRIPT_SUFFIXES)[number];

// Rojo only recognises the script class right before the extension.
export function rojoScriptSuffix(stem: string): RojoScriptSuffix | undefined {
	return ROJO_SCRIPT_SUFFIXES.find((suffix) => stem.endsWith(`.${suffix}`));
}

// The name Rojo gives a file in a synced directory, independent of the config.
export function rojoAssignedName(stem: string): string {
	const suffix = rojoScriptSuffix(stem);
	return suffix ? stem.slice(0, -(suffix.length + 1)) : stem;
}

// Rojo names a `.model.json` file after the part before `.model`.
export function rojoModelName(stem: string): string {
	return stem.endsWith(".model") ? stem.slice(0, -".model".length) : stem;
}

// Rojo reads `.model.json` and `.project.json` as a model and a nested project; only the part before the suffix is ours to name.
export function stripRojoDataSuffix(stem: string): string {
	return stem.replace(/(?<=.)\.(model|project)$/, "");
}

/** The name Rojo gives a file when it enumerates the directory itself. */
export function rojoFileName(kind: RojoFileKind, fileName: string): string {
	const stem = stemOf(fileName);
	if (kind === "script") return rojoAssignedName(stem);
	return kind === "data" ? rojoModelName(stem) : stem;
}

/** Whether Rojo reads `.key` at the end of a stem of this kind as part of the file's type rather than its name. */
function readsAsSuffix(kind: RojoFileKind, key: string): boolean {
	const probe = `x.${key.toLowerCase()}`;
	if (kind === "script") return rojoScriptSuffix(probe) !== undefined;
	return kind === "data" && stripRojoDataSuffix(probe) !== probe;
}

/** The separator that writes `key` as a suffix Rojo leaves in the name: a dot, unless Rojo reads `.key` for this kind of file, then a dash. */
export function suffixSeparator(kind: RojoFileKind, key: string): "." | "-" {
	return readsAsSuffix(kind, key) ? "-" : ".";
}
