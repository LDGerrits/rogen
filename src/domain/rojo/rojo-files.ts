import path from "path";
import { stemOf } from "../../base/path.js";

export type RojoFileKind = "script" | "model" | "data";

export const SCRIPT_EXTENSIONS: readonly string[] = [
	".luau",
	".lua",
	".ts",
	".tsx",
];
const MODEL_EXTENSIONS: readonly string[] = [".rbxm", ".rbxmx"];
const DATA_EXTENSIONS: readonly string[] = [
	".json",
	".toml",
	".csv",
	".txt",
	".yaml",
	".yml",
];

export const META_FILE_SUFFIX = ".meta.json";
export const INIT_META_FILE = `init${META_FILE_SUFFIX}`;
const INIT_SCRIPT = /^(init|index)([.@-][a-z0-9_]+)?\./i;

export function isMetaFile(name: string): boolean {
	return name.toLowerCase().endsWith(META_FILE_SUFFIX);
}

/** What Rojo turns a file into, or `undefined` when it isn't an instance on its own. */
export function classifyFile(name: string): RojoFileKind | undefined {
	const lower = name.toLowerCase();
	if (lower.endsWith(".d.ts") || isMetaFile(name)) return undefined;

	const extension = path.extname(lower);
	if (SCRIPT_EXTENSIONS.includes(extension)) return "script";
	if (MODEL_EXTENSIONS.includes(extension)) return "model";
	if (DATA_EXTENSIONS.includes(extension)) return "data";
	return undefined;
}

export function isInitScript(name: string): boolean {
	return classifyFile(name) === "script" && INIT_SCRIPT.test(name);
}

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

/** A dot, or a dash when Rojo reads `.key` for this kind of file, so the suffix stays in the name. */
export function suffixSeparator(kind: RojoFileKind, key: string): "." | "-" {
	return readsAsSuffix(kind, key) ? "-" : ".";
}

// Rojo only reads `.model` and `.project` as a suffix on `.json` files.
export function rojoDataName(fileName: string): string {
	const stem = stemOf(fileName);
	return path.extname(fileName).toLowerCase() === ".json"
		? stripRojoDataSuffix(stem)
		: stem;
}

/** The name Rojo reads a file's `.meta.json` under, or none for a file that takes no meta. */
export function rojoMetaName(fileName: string): string | undefined {
	const kind = classifyFile(fileName);
	const stem = stemOf(fileName);
	if (kind === "script") return rojoAssignedName(stem);
	if (kind === "data" && rojoDataName(fileName) === stem) return stem;
	return undefined;
}

/** The `.meta.json` Rojo reads for `fileName`, or none for a file that takes no meta. */
export function rojoMetaFile(fileName: string): string | undefined {
	const name = rojoMetaName(fileName);
	return name === undefined ? undefined : `${name}${META_FILE_SUFFIX}`;
}
