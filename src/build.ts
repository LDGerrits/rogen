import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { applyCasing, getOrCreateNode, pruneObject, sortObject, findMissingPaths, RemovedPath, MissingPath } from "./tree.js";
import { resolveRoute, RouteContext, RoutingMaps } from "./route.js";
import { serviceParents, generateRoutingMaps } from "./constants.js";
import { CliArgs, Environment, RogenConfig, RogenMode, RojoNode, RojoTree } from "./types.js";

const SYSTEM_MARKERS = new Set(["raw", "fullnames"]);

interface BuildResult {
	output: string;
	tree: RojoTree;
	missingPaths: MissingPath[];
	removed: RemovedPath[];
	collisions: string[];
	name: string;
	buildDir: string;
	fileCount: number;
}

const isScript = (filename: string): boolean => /\.(tsx?|luau|lua)$/i.test(filename) && !filename.toLowerCase().endsWith(".d.ts");
const isModel = (filename: string): boolean => /\.(rbxm|rbxmx)$/i.test(filename);
const isData = (filename: string): boolean => /\.(json|toml|ya?ml|msgpack|md|txt|csv)$/i.test(filename);
const isValidSource = (filename: string): boolean => isScript(filename) || isModel(filename) || isData(filename);
const isKeepFile = (filename: string): boolean => /^\.(git)?keep(me)?$/i.test(filename);
const isInitFile = (filename: string): boolean => isScript(filename) && /^(index|init)([.-][a-z0-9_]+)?\./i.test(filename);

function buildSubPath(sourceRel: string): string {
	const segments = sourceRel.split(/[\\/]/).filter(Boolean);
	let rootIndex = 0;
	
	while (rootIndex < segments.length && (segments[rootIndex] === ".." || segments[rootIndex] === ".")) {
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
			const entries = await fsp.readdir(currentDir, { withFileTypes: true });
			listings.set(currentDir, entries);

			const hasInit = entries.some(e => e.isFile() && isInitFile(e.name));
			if (hasInit) return;

			const subdirs = entries.filter(e => e.isDirectory()).map(e => path.join(currentDir, e.name));
			await Promise.all(subdirs.map(scan));
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
			throw error;
		}
	}

	await scan(dir);
	return listings;
}

function walkSource(
	dir: string, 
	sourcePath: string, 
	listings: Map<string, fs.Dirent[]>,
	directoryMarkers: Record<string, string>, 
	routingMaps: RoutingMaps, 
	callback: (filepath: string, isInit: boolean) => void
): void {
	const entries = listings.get(dir);
	if (!entries) return;

	// Scan for marker files
	for (const entry of entries) {
		if (entry.isFile() && entry.name.startsWith('.')) {
			const possibleMarker = entry.name.slice(1).toLowerCase();
			if (SYSTEM_MARKERS.has(possibleMarker) || routingMaps.lowerCaseMap[possibleMarker]) {
				let relDir = path.relative(sourcePath, dir);
				relDir = relDir.split(path.sep).join("/");
				directoryMarkers[relDir] = possibleMarker;
				break;
			}
		}
	}
	
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
			walkSource(fullPath, sourcePath, listings, directoryMarkers, routingMaps, callback);
		} else if (isValidSource(entry.name) || isKeepFile(entry.name)) {
			callback(fullPath, false);
		}
	}
}

export async function build(
	targetConfig: RogenMode, 
	baseProjectTree: RojoTree, 
	config: RogenConfig, 
	env: Environment, 
	sourcePaths: string[], 
	cliArgs: CliArgs,
	anchor: string
): Promise<BuildResult> {
	const modeCopy: RogenMode = { ...targetConfig };
	if (cliArgs.output) {
		modeCopy.output = path.resolve(process.cwd(), cliArgs.output);
	} else {
		modeCopy.output = path.resolve(anchor, targetConfig.output);
	}

	if (cliArgs.build) modeCopy.build = cliArgs.build;

	const rojoTree: RojoTree = JSON.parse(JSON.stringify(baseProjectTree));
	rojoTree.tree = rojoTree.tree || { $className: "DataModel" };

	const context: RouteContext = {
		source: config.source || "src",
		...modeCopy,
		isTsProject: env.isTsProject || cliArgs.mode === "ts",
		emitLegacyScripts: rojoTree.emitLegacyScripts ?? true,
		name: rojoTree.name ?? "unknown",
		routingMaps: generateRoutingMaps(config.aliases || {}),
		fullNames: config.fullNames ?? false
	};

	const casing = config.casing ?? "camelCase";

	const nodeOrigins = new WeakMap<RojoNode, { sourcePath: string, filepath: string }>();
	const collisions: string[] = [];
	let fileCount = 0;

	for (const sourcePath of sourcePaths) {
		const relativePath = path.relative(anchor, sourcePath);
		const subPath = buildSubPath(relativePath);
		
		const directoryMarkers: Record<string, string> = {};
		const newContext: RouteContext = {
			...context,
			build: path.join(context.build, subPath),
			directoryMarkers
		};

		const listings = await listTree(sourcePath);

		walkSource(sourcePath, sourcePath, listings, directoryMarkers, context.routingMaps, (filepath, isInit) => {
			fileCount++;

			const relativePath = path.relative(sourcePath, filepath);
			const isKeep = isKeepFile(path.basename(filepath))

			const { targetService, wrapperFolder, virtualParts, nodeName, projectPath } = resolveRoute(relativePath, isInit, newContext);
			
			let current = rojoTree.tree;

			if (serviceParents[targetService]) {
				current = getOrCreateNode(current, serviceParents[targetService]);
			}
			current = getOrCreateNode(current, targetService);
			current = getOrCreateNode(current, applyCasing(wrapperFolder, casing), "Folder");

			for (const part of virtualParts) {
				current = getOrCreateNode(current, part, "Folder");
			}

			if (isKeep) {
				return; 
			}

			const existingNodeRaw = current[nodeName] as RojoNode | undefined;
		
			if (existingNodeRaw && existingNodeRaw.$path) {
				const origin = nodeOrigins.get(existingNodeRaw);
				if (origin && origin.sourcePath === sourcePath) {
					collisions.push(`Name collision: "${origin.filepath}" and "${relativePath}" both map to the node "${nodeName}".`);
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
	
	const prunedTree = pruneObject(rojoTree.tree, context.build, outputDir, removed);
	rojoTree.tree = prunedTree;
	const sortedTree = sortObject(rojoTree);
	const missingPaths = findMissingPaths(sortedTree.tree, context.build, outputDir);

	return {
		output: modeCopy.output,
		tree: sortedTree,
		missingPaths,
		removed,
		collisions,
		name: context.name,
		buildDir: context.build,
		fileCount
	};
}