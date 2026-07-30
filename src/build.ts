import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import picomatch from "picomatch";
import {
	applyCasing,
	getOrCreateNode,
	pruneObject,
	sortObject,
	findMissingPaths,
	RemovedPath,
	MissingPath,
	toPosix,
	collapseFolders,
	isInitFile,
	isValidSource,
	findExposedDataFiles,
} from "./tree.js";
import {
	TagRegexes,
	resolveRoute,
	RouteContext,
	RoutingMaps,
	SystemMarkers,
} from "./route.js";
import {
	serviceParents,
	generateRoutingMaps,
	defaultConfig,
} from "./constants.js";
import {
	CliArgs,
	Environment,
	Config,
	Mode,
	RojoNode,
	RojoTree,
} from "./types.js";

interface BuildResult {
	output: string;
	tree: RojoTree;
	missingPaths: MissingPath[];
	removed: RemovedPath[];
	collisions: string[];
	exposedDataFiles: string[];
	name: string;
	buildDir: string;
	fileCount: number;
}

const SYSTEM_MARKERS: Record<keyof SystemMarkers, true> = {
	structure: true,
	verbatim: true,
	unwrap: true,
};

function buildSubPath(sourceRel: string): string {
	const segments = sourceRel.split(/[\\/]/).filter(Boolean);
	let rootIndex = 0;

	while (
		rootIndex < segments.length &&
		(segments[rootIndex] === ".." || segments[rootIndex] === ".")
	) {
		rootIndex++;
	}

	if (rootIndex + 1 >= segments.length) {
		return "";
	}

	return segments.slice(rootIndex + 1).join("/");
}

async function listTree(dir: string): Promise<Map<string, fs.Dirent[]>> {
	const listings = new Map<string, fs.Dirent[]>();

	async function scan(currentDir: string) {
		try {
			const entries = await fsp.readdir(currentDir, {
				withFileTypes: true,
			});
			listings.set(currentDir, entries);

			const hasInit = entries.some(
				(e) => e.isFile() && isInitFile(e.name)
			);
			if (hasInit) return;

			const subdirs = entries
				.filter((e) => e.isDirectory())
				.map((e) => path.join(currentDir, e.name));
			await Promise.all(subdirs.map(scan));
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			)
				return;
			throw error;
		}
	}

	await scan(dir);

	return listings;
}

function compileTagRegexes(activeEnvs: Set<string>): TagRegexes[] {
	return Array.from(activeEnvs).map((env) => ({
		suffix: new RegExp(`[\\.\\-_\\+]${env}$`, "i"),
		prefix: new RegExp(`^${env}[\\.\\-_\\+]`, "i"),
		middle: new RegExp(`[\\.\\-_\\+]${env}(?=[\\.\\-_\\+])`, "i"),
	}));
}

function buildDirectoryMarkers(
	sourcePath: string,
	listings: Map<string, fs.Dirent[]>,
	routingMaps: RoutingMaps,
	knownFlags: Set<string>
): Record<string, string[]> {
	const directoryMarkers: Record<string, string[]> = {};

	for (const [dir, entries] of listings.entries()) {
		const markers: string[] = [];
		for (const entry of entries) {
			if (entry.isFile() && entry.name.startsWith(".")) {
				const possibleMarker = entry.name.slice(1).toLowerCase();
				if (
					possibleMarker in SYSTEM_MARKERS ||
					routingMaps.lowerCaseMap[possibleMarker] ||
					knownFlags.has(possibleMarker)
				) {
					markers.push(possibleMarker);
				}
			}
		}

		if (markers.length > 0) {
			let relDir = path.relative(sourcePath, dir);
			relDir = relDir.split(path.sep).join("/");
			directoryMarkers[relDir] = markers;
		}
	}

	return directoryMarkers;
}

function walkSource(
	dir: string,
	sourcePath: string,
	listings: Map<string, fs.Dirent[]>,
	callback: (filepath: string, isInit: boolean) => void
): void {
	const entries = listings.get(dir);
	if (!entries) return;

	// Rojo expects a specific structure for folders with an init.luau file that we cannot deviate from.
	// Because of this, we must return early if an initialization file has been found.
	const initFile = entries.find((e) => e.isFile() && isInitFile(e.name));
	if (initFile) {
		callback(path.join(dir, initFile.name), true);
		return;
	}

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkSource(fullPath, sourcePath, listings, callback);
		} else if (isValidSource(entry.name)) {
			callback(fullPath, false);
		}
	}
}

export async function build(
	targetConfig: Mode,
	baseProjectTree: RojoTree,
	config: Config,
	env: Environment,
	sourcePaths: string[],
	cliArgs: CliArgs,
	anchor: string
): Promise<BuildResult> {
	const modeCopy: Mode = { ...targetConfig };
	if (cliArgs.output) {
		modeCopy.output = path.resolve(process.cwd(), cliArgs.output);
	} else {
		modeCopy.output = path.resolve(anchor, targetConfig.output);
	}

	if (cliArgs.build) {
		modeCopy.build = cliArgs.build;
	}

	const rojoTree = structuredClone(baseProjectTree);

	const mergedTags = { ...(config.tags || {}), ...(modeCopy.tags || {}) };
	const knownTags = new Set(
		Object.keys(config.tags || {}).map((t) => t.toLowerCase())
	);

	const activeTags = new Set(
		Object.keys(mergedTags)
			.filter((t) => mergedTags[t])
			.map((t) => t.toLowerCase())
	);

	const cliTags = (cliArgs.tag || []).map((t) => t.toLowerCase());
	for (const tag of cliTags) {
		activeTags.add(tag);
	}

	for (const tag of activeTags) {
		if (!knownTags.has(tag)) {
			throw new Error(
				`active tag "${tag}" is not declared in the root "tags" object.`
			);
		}
	}

	const tagRegexes = compileTagRegexes(activeTags);

	const context: RouteContext = {
		source: config.source || structuredClone(defaultConfig.source),
		...modeCopy,
		isTsProject: env.isTsProject || (cliArgs.mode?.includes("ts") ?? false),
		emitLegacyScripts: rojoTree.emitLegacyScripts ?? true,
		name: rojoTree.name,
		routingMaps: generateRoutingMaps(config.aliases || {}),
		verbatim: config.verbatim ?? defaultConfig.verbatim,
		unwrap: config.unwrap ?? defaultConfig.unwrap,
		directoryMarkers: {},
		knownTags,
		activeTags,
		tagRegexes,
	};

	const combinedGlobIgnorePaths = Array.from(
		new Set([
			...(config.globIgnorePaths || []),
			...(modeCopy.globIgnorePaths || []),
		])
	);
	const isIgnored =
		combinedGlobIgnorePaths.length > 0
			? picomatch(combinedGlobIgnorePaths)
			: () => false;

	const nodeOrigins = new WeakMap<
		RojoNode,
		{ sourcePath: string; filepath: string }
	>();
	const collisions: string[] = [];
	let fileCount = 0;

	for (const sourcePath of sourcePaths) {
		const relativePath = path.relative(anchor, sourcePath);
		const subPath = buildSubPath(relativePath);

		const listings = await listTree(sourcePath);

		const directoryMarkers = buildDirectoryMarkers(
			sourcePath,
			listings,
			context.routingMaps,
			knownTags
		);

		const newContext: RouteContext = {
			...context,
			build: path.join(context.build, subPath),
			directoryMarkers,
		};

		walkSource(sourcePath, sourcePath, listings, (filepath, isInit) => {
			const relativePath = path.relative(sourcePath, filepath);
			if (isIgnored(toPosix(relativePath))) return;

			const {
				targetService,
				wrapperFolder,
				virtualParts,
				nodeName,
				projectPath,
				dropped,
				unwrap,
			} = resolveRoute(relativePath, isInit, newContext);

			if (dropped) return;
			fileCount++;

			let current = rojoTree.tree;
			if (serviceParents[targetService]) {
				current = getOrCreateNode(
					current,
					serviceParents[targetService]
				);
			}
			current = getOrCreateNode(current, targetService);

			if (!unwrap) {
				current = getOrCreateNode(
					current,
					applyCasing(wrapperFolder, config.casing),
					"Folder"
				);
			}

			for (const part of virtualParts) {
				current = getOrCreateNode(current, part, "Folder");
			}

			const existingNodeRaw = current[nodeName] as RojoNode | undefined;
			if (existingNodeRaw && existingNodeRaw.$path) {
				const origin = nodeOrigins.get(existingNodeRaw);
				if (origin && origin.sourcePath === sourcePath) {
					collisions.push(
						`Name collision: "${origin.filepath}" and "${relativePath}" both map to the node "${nodeName}".`
					);
				}
			}

			const existingNode = existingNodeRaw || {};
			const newNode: RojoNode = { ...existingNode, $path: projectPath };
			if (newNode.$className === "Folder") {
				delete newNode.$className;
			}

			current[nodeName] = newNode;
			nodeOrigins.set(newNode, { sourcePath, filepath: relativePath });
		});
	}

	const outputDir = path.dirname(modeCopy.output);
	const removed: RemovedPath[] = [];

	const prunedTree = pruneObject(
		rojoTree.tree,
		context.build,
		outputDir,
		removed
	);

	collapseFolders(prunedTree, context.build, outputDir);

	rojoTree.tree = prunedTree;

	const sortedTree = sortObject(rojoTree);
	const missingPaths = findMissingPaths(
		sortedTree.tree,
		context.build,
		outputDir
	);
	const exposedDataFiles = findExposedDataFiles(sortedTree.tree);

	return {
		output: modeCopy.output,
		tree: sortedTree,
		missingPaths,
		removed,
		collisions,
		exposedDataFiles,
		name: context.name,
		buildDir: context.build,
		fileCount,
	};
}
