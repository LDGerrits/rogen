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

export function getOrCreateNode(
	parent: RojoNode,
	key: string,
	className?: string
): RojoNode {
	if (!parent[key]) {
		parent[key] = className == null ? {} : { $className: className };
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

		if (childNode.$path) {
			if (hasPathPrefix(childNode.$path, buildDir)) continue;

			const absolutePath = path.resolve(outputDir, childNode.$path);
			if (!fs.existsSync(absolutePath)) {
				delete node[key];
				removed.push({
					treePath: childTreePath,
					rojoPath: childNode.$path,
				});
				continue;
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

		if (childNode.$path && hasPathPrefix(childNode.$path, buildDir)) {
			const absolutePath = path.resolve(outputDir, childNode.$path);
			if (!fs.existsSync(absolutePath)) {
				missing.push({
					parent: node,
					key,
					treePath: childTreePath,
					path: childNode.$path,
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

const ROJO_SAFE_EXTENSIONS = new Set([
	".lua",
	".luau",
	".server.lua",
	".server.luau",
	".client.lua",
	".client.luau",
	".json",
	".toml",
	".yaml",
	".yml",
	".csv",
	".txt",
	".md",
	".msgpack",
	".rbxm",
	".rbxmx",
]);

export function collapseFolders(
	node: RojoNode,
	buildDir: string,
	outputDir: string
): void {
	let childCount = 0;
	let canCollapse = true;
	let commonDir: string | null = null;

	for (const key in node) {
		if (key.startsWith("$")) continue;

		const val = node[key];
		if (typeof val !== "object" || val === null) continue;

		const childNode = val as RojoNode;

		// Process deepest nested children first
		collapseFolders(childNode, buildDir, outputDir);

		childCount++;

		if (!childNode.$path) {
			canCollapse = false;
		} else {
			const childAbsPath = path.resolve(outputDir, childNode.$path);
			const parentDir = path.dirname(childAbsPath);

			// All children should share the same directory
			if (commonDir === null) {
				commonDir = parentDir;
			} else if (commonDir !== parentDir) {
				canCollapse = false;
			}

			const fileName = path.basename(childAbsPath);
			if (fileName !== key) {
				let matchedExt = false;
				for (const ext of ROJO_SAFE_EXTENSIONS) {
					if (fileName === key + ext) {
						matchedExt = true;
						break;
					}
				}
				// If the name doesn't match the key perfectly, do not collapse
				if (!matchedExt) {
					canCollapse = false;
				}
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

	try {
		const diskItems = fs.readdirSync(commonDir);
		if (diskItems.length !== childCount) {
			return;
		}
	} catch {
		return;
	}

	// Replace all child files with a single folder $path
	const relativeCommonDir = toPosix(path.relative(outputDir, commonDir));

	for (const key in node) {
		if (!key.startsWith("$")) {
			delete node[key];
		}
	}

	node.$path = relativeCommonDir;
	delete node.$className;
}
