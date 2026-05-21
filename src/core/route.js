const path = require("path");
const { 
	lowerCaseServiceMap, 
	serviceAliases, 
	separatorRegex, 
	pascalCaseRegex, 
	services, 
	serverContainers, 
	clientContainers 
} = require("../constants");
const { toPosix } = require("./tree");

function resolveRoute(relativePath, isInit, { emitLegacyScripts, isTsProject, build }) {
	const parts = relativePath.split(path.sep);
	const filename = parts.pop();
	const basename = path.basename(filename, path.extname(filename));
	const virtualParts = [];

	let targetService = "ReplicatedStorage";
	let lastRouteKeyword = null;
	let environment = null;

	// Folder routing
	for (const part of parts) {
		const lowerPart = part.toLowerCase();
		const matchedService = lowerCaseServiceMap[lowerPart];

		if (matchedService) {
			targetService = matchedService;
			lastRouteKeyword = lowerPart;
			if (serviceAliases.has(lowerPart)) environment = lowerPart;
		} else {
			virtualParts.push(part);
		}
	}

	let matchedSuffixLength = 0;
	let mappedService = null;
	const sepMatch = basename.match(separatorRegex);
	const pascalMatch = basename.match(pascalCaseRegex);

	// Suffix routing
	if (sepMatch) {
		const suffix = sepMatch[1].toLowerCase();
		mappedService = lowerCaseServiceMap[suffix];
		matchedSuffixLength = sepMatch[0].length;
		if (!isInit && serviceAliases.has(suffix)) environment = suffix;
	} else if (pascalMatch) {
		const suffix = pascalMatch[1].toLowerCase();
		mappedService = services[pascalMatch[1]];
		matchedSuffixLength = pascalMatch[0].length;
		if (!isInit && serviceAliases.has(suffix)) environment = suffix;
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
			nodeName = basename.slice(0, -matchedSuffixLength);
		} 
	}

	return { targetService, wrapperFolder, virtualParts, nodeName, projectPath };
}

module.exports = { resolveRoute };