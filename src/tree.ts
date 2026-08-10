import fs from "fs";
import path from "path";
import { Casing, RojoNode } from "./types.js";

export interface RemovedPath {
	treePath: string;
	rojoPath: string;
}

export interface MissingPath {
	parent: RojoNode;
	key: string;
	path: string;
	absolutePath: string;
	treePath: string;
}

export interface ExposedDataFile {
	parent: RojoNode;
	key: string;
	path: string;
}

function hasPathPrefix(p: string, dir: string): boolean {
	return p === dir || p.startsWith(dir + "/");
}

export const toPosix = (p: string): string => p.split(path.sep).join("/");

export function applyCasing(value: string, casing: Casing): string {
	if (value.length === 0) return value;
	const firstCharacter =
		casing === "PascalCase"
			? value[0].toUpperCase()
			: value[0].toLowerCase();

	return firstCharacter + value.slice(1);
}

export function getPathString(node: RojoNode): string | undefined {
	const p = node.$path;
	if (typeof p === "string") return p;
	if (p && typeof p === "object" && typeof p.optional === "string")
		return p.optional;
	return undefined;
}

export function getOrCreateNode(
	parent: RojoNode,
	key: string,
	className?: string
): RojoNode {
	if (!parent[key]) {
		parent[key] =
			className == null
				? {}
				: { $className: className, $ignoreUnknownInstances: false };
	} else if (className != null) {
		const existing = parent[key] as RojoNode;
		if (
			existing.$ignoreUnknownInstances === undefined &&
			existing.$path === undefined
		) {
			existing.$ignoreUnknownInstances = false;
		}
	}
	return parent[key] as RojoNode;
}

export function pruneObject(
	node: RojoNode,
	buildDir: string,
	outputDir: string,
	removed: RemovedPath[] = [],
	treePath = ""
): RojoNode {
	for (const key in node) {
		const val = node[key];
		if (typeof val !== "object" || val === null) continue;

		const childTreePath = treePath ? `${treePath}.${key}` : key;
		const childNode = val as RojoNode;

		const childPath = getPathString(childNode);
		if (childPath) {
			if (hasPathPrefix(childPath, buildDir)) continue;

			// Optional paths are allowed to be absent so only required (string) template
			// paths are pruned when missing.
			const isOptional = typeof childNode.$path === "object";
			if (!isOptional) {
				const absolutePath = path.resolve(outputDir, childPath);
				if (!fs.existsSync(absolutePath)) {
					delete node[key];
					removed.push({
						treePath: childTreePath,
						rojoPath: childPath,
					});
					continue;
				}
			}
		}
		pruneObject(childNode, buildDir, outputDir, removed, childTreePath);
	}
	return node;
}

export function sortObject<T>(obj: T): T {
	if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
		return obj;
	}

	const record = obj as Record<string, unknown>;

	return Object.keys(record)
		.sort()
		.reduce((acc: Record<string, unknown>, key: string) => {
			acc[key] = sortObject(record[key]);
			return acc;
		}, {}) as T;
}

export function findMissingPaths(
	node: RojoNode,
	buildDir: string,
	outputDir: string,
	missing: MissingPath[] = [],
	treePath = ""
): MissingPath[] {
	for (const key in node) {
		const val = node[key];
		if (typeof val !== "object" || val === null) continue;

		const childTreePath = treePath ? `${treePath}.${key}` : key;
		const childNode = val as RojoNode;

		const childPath = getPathString(childNode);
		if (childPath && hasPathPrefix(childPath, buildDir)) {
			const absolutePath = path.resolve(outputDir, childPath);
			if (!fs.existsSync(absolutePath)) {
				missing.push({
					parent: node,
					key,
					treePath: childTreePath,
					path: childPath,
					absolutePath,
				});
			}
		}
		findMissingPaths(
			childNode,
			buildDir,
			outputDir,
			missing,
			childTreePath
		);
	}
	return missing;
}

const isScript = (filename: string): boolean =>
	/\.(tsx?|luau|lua)$/i.test(filename) &&
	!filename.toLowerCase().endsWith(".d.ts");

const isModel = (filename: string): boolean =>
	/\.(rbxm|rbxmx)$/i.test(filename);

export function isData(filename: string): boolean {
	if (isScript(filename) || isModel(filename)) return false;

	if (filename.toLowerCase().endsWith(".d.ts")) return false;

	if (filename.startsWith(".")) return false;

	return /\.[a-z0-9]+$/i.test(filename);
}

export const isValidSource = (filename: string): boolean =>
	isScript(filename) || isModel(filename) || isData(filename);

export const isInitFile = (filename: string): boolean =>
	isScript(filename) && /^(index|init)([.-][a-z0-9_]+)?\./i.test(filename);

function getRojoBaseName(filename: string): string {
	if (isScript(filename)) {
		return filename
			.replace(/\.(server|client)\.(luau?|lua|tsx?)$/i, "")
			.replace(/\.(luau?|lua|tsx?)$/i, "");
	}
	if (isModel(filename)) {
		return filename.replace(/\.(rbxmx?)$/i, "");
	}
	if (isData(filename)) {
		return filename.replace(/\.[a-z0-9]+$/i, "");
	}
	return filename;
}

export function collapseFolders(
	node: RojoNode,
	buildDir: string,
	outputDir: string,
	isIgnored: (path: string) => boolean = () => false
): void {
	let childCount = 0;
	let canCollapse = node.$path === undefined; // Prevent overwriting a folder with an explicit $path
	let commonDir: string | null = null;

	for (const key in node) {
		if (key.startsWith("$")) continue;

		const val = node[key];
		if (typeof val !== "object" || val === null) continue;

		const childNode = val as RojoNode;

		// Process deepest nested children first
		collapseFolders(childNode, buildDir, outputDir, isIgnored);

		childCount++;

		const childPath = getPathString(childNode);
		if (!childPath) {
			canCollapse = false;
		} else {
			const childAbsPath = path.resolve(outputDir, childPath);
			const parentDir = path.dirname(childAbsPath);

			// All children should share the same directory
			if (commonDir === null) {
				commonDir = parentDir;
			} else if (commonDir !== parentDir) {
				canCollapse = false;
			}

			const fileName = path.basename(childAbsPath);
			if (getRojoBaseName(fileName) !== key) {
				canCollapse = false;
			}
		}
	}

	if (childCount === 0 || !canCollapse || commonDir === null) {
		return;
	}

	const absoluteBuildDir = path.resolve(outputDir, buildDir);
	if (!hasPathPrefix(toPosix(commonDir), toPosix(absoluteBuildDir))) {
		return;
	}

	const relativeCommonDir = toPosix(path.relative(outputDir, commonDir));

	try {
		const diskItems = fs.readdirSync(commonDir);
		// filter out marker files and ignored files so they do not prevent folders from collapsing
		const visibleDiskItems = diskItems.filter(
			(item) =>
				!item.startsWith(".") &&
				!isIgnored(toPosix(path.join(relativeCommonDir, item)))
		);
		if (visibleDiskItems.length !== childCount) {
			return;
		}
	} catch {
		return;
	}

	// Replace all child files with a single folder $path
	for (const key in node) {
		if (!key.startsWith("$")) {
			delete node[key];
		}
	}

	node.$path = { optional: relativeCommonDir };
	delete node.$className;
}

export function findExposedDataFiles(
	node: RojoNode,
	exposed: ExposedDataFile[] = []
): ExposedDataFile[] {
	for (const key in node) {
		if (key.startsWith("$")) continue;

		const val = node[key];
		if (typeof val !== "object" || val === null) continue;

		const childNode = val as RojoNode;
		const childPath = getPathString(childNode);

		// Check if the current node exposes a raw data file path
		if (childPath && isData(childPath)) {
			exposed.push({ parent: node, key, path: childPath });
		}

		findExposedDataFiles(childNode, exposed);
	}

	return exposed;
}
