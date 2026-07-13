import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { applyCasing, getOrCreateNode, pruneObject, sortObject, findMissingPaths } from "./tree.js";
import { resolveRoute } from "./route.js";
import { serviceParents, generateRoutingMaps } from "./constants.js";
import { BuildResult, CliArgs, Environment, RemovedPath, RogenConfig, RogenMode, RojoNode, RojoTree, RouteContext, RoutingMaps } from "./types.js";

const isScript = (filename: string): boolean => /\.(tsx?|luau|lua)$/i.test(filename) && !filename.toLowerCase().endsWith(".d.ts");
const isModel = (filename: string): boolean => /\.(rbxm|rbxmx)$/i.test(filename);
const isValidSource = (filename: string): boolean => isScript(filename) || isModel(filename);
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
			if (routingMaps.lowerCaseMap[possibleMarker]) {
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
		} else if (isValidSource(entry.name)) {
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
		keepRouteNames: config.keepRouteNames ?? false
	};

	const casing = config.casing ?? "camelCase";

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

			const existingNode = (current[nodeName] as RojoNode) || {};
			const newNode: RojoNode = { ...existingNode, $path: projectPath };
			
			if (newNode.$className === "Folder") {
				delete newNode.$className;
			}
			
			current[nodeName] = newNode;
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
		name: context.name,
		buildDir: context.build,
		fileCount
	};
}