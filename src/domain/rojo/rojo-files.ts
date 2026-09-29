import path from "path";

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
