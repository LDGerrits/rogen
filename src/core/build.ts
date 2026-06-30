import fs from "fs";
import path from "path";
import { getOrCreateNode, pruneObject, sortObject, findMissingPaths } from "./tree.js";
import { resolveRoute } from "./route.js";
import { serviceParents, generateRoutingMaps } from "../constants.js";
import { BuildResult, CliArgs, Environment, RogenConfig, RogenMode, RojoNode, RojoTree, RouteContext, RoutingMaps } from "../types.js";

const isScript = (filename: string): boolean => /\.(tsx?|luau|lua)$/i.test(filename) && !filename.toLowerCase().endsWith(".d.ts");
const isModel = (filename: string): boolean => /\.(rbxm|rbxmx)$/i.test(filename);
const isValidSource = (filename: string): boolean => isScript(filename) || isModel(filename);
const isInitFile = (filename: string): boolean => isScript(filename) && /^(index|init)([.-][a-z0-9_]+)?\./i.test(filename);

function walk(
	dir: string, 
	sourcePath: string, 
	directoryMarkers: Record<string, string>, 
	routingMaps: RoutingMaps, 
	callback: (filepath: string, isInit: boolean) => void
): void {
	if (!fs.existsSync(dir)) return;

	const entries = fs.readdirSync(dir, { withFileTypes: true });

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
			walk(fullPath, sourcePath, directoryMarkers, routingMaps, callback);
		} else if (isValidSource(entry.name)) {
			callback(fullPath, false);
		}
	}
}

export function build(
	targetConfig: RogenMode, 
	baseProjectTree: RojoTree, 
	config: RogenConfig, 
	env: Environment, 
	sourcePaths: string[], 
	cliArgs: CliArgs
): BuildResult {
	const modeCopy: RogenMode = { ...targetConfig };
	if (cliArgs.output) modeCopy.output = cliArgs.output;
	if (cliArgs.build) modeCopy.build = cliArgs.build;

	const rojoTree: RojoTree = JSON.parse(JSON.stringify(baseProjectTree));
	rojoTree.tree = rojoTree.tree || { $className: "DataModel" };

	const context: RouteContext = {
		source: config.source || "src",
		...modeCopy,
		isTsProject: env.isTsProject,
		emitLegacyScripts: rojoTree.emitLegacyScripts ?? true,
		name: rojoTree.name ?? "unknown",
		routingMaps: generateRoutingMaps(config.aliases || {}),
		keepRouteNames: cliArgs.keepRouteNames ?? config.keepRouteNames ?? false
	};

	let fileCount = 0;

	for (const sourcePath of sourcePaths) {

		// Calculate the sub-path of to append to our build directory for multi-place support.
		// So, if source is "src/hub" and build is "out", subPath becomes "hub", and context.build 
		// becomes "out/hub".
		const relativePath = path.relative(process.cwd(), sourcePath);
		const segments = relativePath.split(path.sep);
		const subPath = segments.length > 1 ? segments.slice(1).join(path.sep) : "";
		
		const directoryMarkers: Record<string, string> = {};
		const newContext: RouteContext = {
			...context,
			build: path.join(context.build, subPath),
			directoryMarkers
		};

		walk(sourcePath, sourcePath, directoryMarkers, context.routingMaps, (filepath, isInit) => {
			fileCount++;
			const relativePath = path.relative(sourcePath, filepath);
			const { targetService, wrapperFolder, virtualParts, nodeName, projectPath } = resolveRoute(relativePath, isInit, newContext);
			
			let current = rojoTree.tree;

			if (serviceParents[targetService]) {
				current = getOrCreateNode(current, serviceParents[targetService]);
			}
			current = getOrCreateNode(current, targetService);
			current = getOrCreateNode(current, wrapperFolder, "Folder");

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

	const prunedTree = pruneObject(rojoTree.tree, context.build);
	rojoTree.tree = prunedTree;
	
	const sortedTree = sortObject(rojoTree);
	const missingPaths = findMissingPaths(sortedTree.tree, context.build);

	return {
		output: context.output,
		tree: sortedTree,
		missingPaths,
		name: context.name,
		buildDir: context.build,
		fileCount
	};
}