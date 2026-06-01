const fs = require("fs");
const path = require("path");
const { getOrCreateNode, pruneObject, sortObject, findMissingPaths } = require("./tree");
const { resolveRoute } = require("./route");
const { serviceParents, generateRoutingMaps } = require("../constants");

const isScript = (filename) => /\.(tsx?|luau|lua)$/i.test(filename) && !filename.toLowerCase().endsWith(".d.ts");
const isModel = (filename) => /\.(rbxm|rbxmx)$/i.test(filename);
const isValidSource = (filename) => isScript(filename) || isModel(filename);
const isInitFile = (filename) => isScript(filename) && /^(index|init)([\.-][a-z0-9_]+)?\./i.test(filename);

function walk(dir, callback) {
	if (!fs.existsSync(dir)) return;
	
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const initFile = entries.find((e) => e.isFile() && isInitFile(e.name));

	if (initFile) {
		callback(path.join(dir, initFile.name), true);
		return; // Rojo auto-syncs the directory, skip explicit children
	}

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(fullPath, callback);
		} else if (isValidSource(entry.name)) {
			callback(fullPath, false);
		}
	}
}

function build(targetConfig, baseProjectTree, config, env, sourcePaths, cliArgs) {
	const modeCopy = { ...targetConfig };
	if (cliArgs.output) modeCopy.output = cliArgs.output;
	if (cliArgs.build) modeCopy.build = cliArgs.build;

	const rojoTree = JSON.parse(JSON.stringify(baseProjectTree));
	rojoTree.tree = rojoTree.tree || { $className: "DataModel" };

	const context = {
		source: config.source || "src",
		...modeCopy,
		isTsProject: env.isTsProject,
		emitLegacyScripts: rojoTree.emitLegacyScripts ?? true,
		name: rojoTree.name ?? "unknown",
		routingMaps: generateRoutingMaps(config.aliases || {}),
		keepSuffixes: cliArgs.keepSuffixes ?? config.keepSuffixes ?? false
	};

	let fileCount = 0;

	for (const sourcePath of sourcePaths) {
		walk(sourcePath, (filepath, isInit) => {
			fileCount++;
			const relativePath = path.relative(sourcePath, filepath);
			const { targetService, wrapperFolder, virtualParts, nodeName, projectPath } = resolveRoute(relativePath, isInit, context);
			
			let current = rojoTree.tree;

			if (serviceParents[targetService]) {
				current = getOrCreateNode(current, serviceParents[targetService]);
			}
			current = getOrCreateNode(current, targetService);
			current = getOrCreateNode(current, wrapperFolder, "Folder");

			for (const part of virtualParts) {
				current = getOrCreateNode(current, part, "Folder");
			}

			current[nodeName] = { ...current[nodeName], $path: projectPath };
			if (current[nodeName]["$className"] === "Folder") {
				delete current[nodeName]["$className"];
			}
		});
	}

	const prunedTree = pruneObject(rojoTree, context.build);
	const sortedTree = sortObject(prunedTree);
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

module.exports = { build };