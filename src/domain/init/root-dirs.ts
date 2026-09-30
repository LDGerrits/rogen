import path from "path";
import { contains, normalizeDir } from "../../base/path.js";
import { rootDirOverlap } from "../config/config.js";
import { DetectedWorkspace, Language } from "../toolchain/toolchain.js";

const DEFAULT_ROOT_DIR = "src";

/** The first that applies: the language's own config, `src`, the only code folder, else `src`. */
export function defaultRootDir(
	workspace: DetectedWorkspace,
	language: Language
): string {
	const configured = language.configuredRootDir(workspace);
	if (configured !== undefined) return configured;
	if (workspace.hasSrc) return DEFAULT_ROOT_DIR;
	return workspace.codeFolders.length === 1
		? workspace.codeFolders[0]
		: DEFAULT_ROOT_DIR;
}

/** The hint line naming the code folders the placeholder doesn't cover, or `undefined` when there are none. */
export function otherCodeFoldersHint(
	workspace: DetectedWorkspace,
	rootDir: string
): string | undefined {
	const [topLevel] = rootDir.split("/");
	const others = workspace.codeFolders.filter(
		(folder) => folder !== topLevel
	);
	return others.length > 0
		? `Also found code in: ${others.join(", ")}`
		: undefined;
}

/** A comma-separated answer, normalized. */
export const parseRootDirs = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "")
		.map(normalizeDir);

/**
 * The first reason `entries` can't be a config's root dirs, or `undefined`.
 * The config's own overlap rule decides what would be rejected, so init never
 * writes a config that can't build. `directory` is where the entries are
 * relative to.
 */
export function rootDirsProblem(
	directory: string,
	entries: readonly string[]
): string | undefined {
	if (entries.length === 0) return "Enter at least one root dir.";
	for (const entry of entries) {
		if (path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry)) {
			return `Use a path relative to here, not ${entry}.`;
		}
		const normalized = normalizeDir(entry);
		if (normalized === ".." || normalized.startsWith("../")) {
			return `${entry} is outside this folder.`;
		}
	}
	const normalized = entries.map(normalizeDir);
	const absolute = normalized.map((entry) => path.resolve(directory, entry));
	for (const [index, entry] of normalized.entries()) {
		const overlap = rootDirOverlap(absolute, index);
		if (overlap?.kind === "duplicate") return `${entry} is listed twice.`;
		if (overlap?.kind === "nested") {
			const outer = normalized[absolute.indexOf(overlap.outer)];
			return `${entry} is inside ${outer}. List only one of them.`;
		}
	}
	return undefined;
}

/** The first reason `folder` can't join `rootDirs` as a place's own code, or `undefined`. */
export function placeFolderProblem(
	directory: string,
	rootDirs: readonly string[],
	folder: string
): string | undefined {
	const normalized = normalizeDir(folder);
	const resolved = path.resolve(directory, normalized);
	const overlapping = rootDirs.find((dir) => {
		const other = path.resolve(directory, dir);
		return contains(other, resolved) || contains(resolved, other);
	});
	return overlapping === undefined
		? rootDirsProblem(directory, [...rootDirs, folder])
		: `${normalized} overlaps ${overlapping}, one of default's root dirs. Pick a folder outside it.`;
}
