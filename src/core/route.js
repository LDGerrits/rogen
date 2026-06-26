const path = require("path");
const { 
	serviceAliases, 
	serverContainers, 
	clientContainers
} = require("../constants");
const { toPosix } = require("./tree");

function resolveRoute(relativePath, isInit, context) {
	const { emitLegacyScripts, isTsProject, build, routingMaps, keepSuffixes } = context;
	const { mergedServices, lowerCaseMap, separatorSuffixRegex, pascalCaseSuffixRegex, prefixRegex } = routingMaps;

	const parts = relativePath.split(/[\\/]/)
	const filename = parts.pop();
	const basename = path.basename(filename, path.extname(filename));
	const virtualParts = [];

	let targetService = "ReplicatedStorage";
	let lastRouteKeyword = null;
	let environment = null;

	// Folder routing
	for (const part of parts) {
		const lowerPart = part.toLowerCase();
		const matchedService = lowerCaseMap[lowerPart];

		if (matchedService) {
			targetService = matchedService;
			lastRouteKeyword = lowerPart;
			if (serviceAliases.has(lowerPart)) environment = lowerPart;
		} else {
			virtualParts.push(part);
		}
	}

	let matchedLength = 0;
	let mappedService = null;
	let isPrefix = false;

	const sepSuffixMatch = basename.match(separatorSuffixRegex);
	const pascalSuffixMatch = basename.match(pascalCaseSuffixRegex);
	const prefixMatch = basename.match(prefixRegex);

	// Suffix routing
	if (sepSuffixMatch) {
		const suffix = sepSuffixMatch[1].toLowerCase();
		mappedService = lowerCaseMap[suffix];
		matchedLength = sepSuffixMatch[0].length;
		if (!isInit && serviceAliases.has(suffix)) environment = suffix;
	} else if (pascalSuffixMatch) {
		const suffix = pascalSuffixMatch[1].toLowerCase();
		mappedService = mergedServices[pascalSuffixMatch[1]];
		matchedLength = pascalSuffixMatch[0].length;
		if (!isInit && serviceAliases.has(suffix)) environment = suffix;
	} 
	// Prefix routing
	else if (prefixMatch) {
		const prefix = prefixMatch[1].toLowerCase();
		mappedService = lowerCaseMap[prefix];
		matchedLength = prefixMatch[0].length;
		if (!isInit && serviceAliases.has(prefix)) environment = prefix;
		isPrefix = true;
	}

	if (mappedService && !lastRouteKeyword) targetService = mappedService;

	// Resolve namespace wrapper folder
	let wrapperFolder = "shared";
	if (serverContainers.has(targetService)) wrapperFolder = "server";
	else if (clientContainers.has(targetService)) wrapperFolder = "client";
	else if (environment) wrapperFolder = environment;

	// Scripts with non-legacy RunContext run incorrectly in StarterPlayer container.
	const isStarterPlayerContainer = targetService === "StarterPlayerScripts" || targetService === "StarterCharacterScripts";
	if (emitLegacyScripts === false && isStarterPlayerContainer) {
		targetService = "ReplicatedStorage";
	}

	let nodeName = basename;
	let projectPath = "";

	if (isInit) {
		const folderRelativePath = path.dirname(relativePath);
		projectPath = toPosix(path.join(build, folderRelativePath));
		if (virtualParts.length > 0) nodeName = virtualParts.pop();
		else nodeName = lastRouteKeyword ? lastRouteKeyword : "source";
	} else {
		let compiledRelativePath = relativePath;
		if (isTsProject) {
			const compiledFilename = filename.replace(/\.tsx?$/i, ".luau");
			compiledRelativePath = path.join(path.dirname(relativePath), compiledFilename);
		}
		projectPath = toPosix(path.join(build, compiledRelativePath));
		if (mappedService) {
			let shouldStrip = !keepSuffixes;

			// Rojo relies on '.server' and '.client' explicitly for script types.
			// Even if keepSuffixes is true, we must strip these exact dot-prefixes.
			if (keepSuffixes && sepSuffixMatch) {
				const exactMatch = sepSuffixMatch[0].toLowerCase();
				if (exactMatch === ".server" || exactMatch === ".client") {
					shouldStrip = true;
				}
			}

			if (shouldStrip) {
				if (isPrefix) {
					nodeName = basename.slice(matchedLength); 
				} else {
					nodeName = basename.slice(0, -matchedLength); 
				}
			}
		} 
	}

	return { targetService, wrapperFolder, virtualParts, nodeName, projectPath };
}

module.exports = { resolveRoute };