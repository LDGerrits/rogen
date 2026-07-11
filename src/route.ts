import path from "path";
import { 
	serviceAliases, 
	serverContainers, 
	clientContainers
} from "./constants.js";
import { toPosix } from "./tree.js";
import { RouteContext } from "./types.js";

export interface RouteResolution {
	targetService: string;
	wrapperFolder: string;
	virtualParts: string[];
	nodeName: string;
	projectPath: string;
}

export function resolveRoute(relativePath: string, isInit: boolean, context: RouteContext): RouteResolution {
	const { emitLegacyScripts, isTsProject, build, routingMaps, keepRouteNames, directoryMarkers } = context;
	const { mergedServices, lowerCaseMap, separatorSuffixRegex, pascalCaseSuffixRegex, separatorPrefixRegex, camelCasePrefixRegex } = routingMaps;

	const parts = relativePath.split(/[\\/]/);
	const filename = parts.pop()!;
	const basename = path.basename(filename, path.extname(filename));
	const virtualParts: string[] = [];

	let targetService = "ReplicatedStorage";
	let lastRouteKeyword: string | null = null;
	let environment: string | null = null;

	// Marker routing
	if (directoryMarkers && directoryMarkers[""]) {
		const rootMarker = directoryMarkers[""];
		targetService = lowerCaseMap[rootMarker];
		lastRouteKeyword = rootMarker;
		if (serviceAliases.has(rootMarker)) environment = rootMarker;
	}

	// Folder routing
	let currentPath = "";
	for (const part of parts) {
		currentPath = currentPath ? `${currentPath}/${part}` : part;

		const lowerPart = part.toLowerCase();
		const matchedService = lowerCaseMap[lowerPart];
		const marker = directoryMarkers ? directoryMarkers[currentPath] : undefined;

		if (marker) {
			targetService = lowerCaseMap[marker];
			lastRouteKeyword = marker;
			if (serviceAliases.has(marker)) environment = marker;
			
			// Strip if the folder name is also a routing keyword
			if (!matchedService) {
				virtualParts.push(part);
			}
		} else if (matchedService) {
			targetService = matchedService;
			lastRouteKeyword = lowerPart;
			if (serviceAliases.has(lowerPart)) environment = lowerPart;
		} else {
			virtualParts.push(part);
		}
	}

	let matchedLength = 0;
	let mappedService: string | null = null;
	let isPrefix = false;

	const sepSuffixMatch = basename.match(separatorSuffixRegex);
	const pascalSuffixMatch = basename.match(pascalCaseSuffixRegex);
	const sepPrefixMatch = basename.match(separatorPrefixRegex);
	const camelPrefixMatch = basename.match(camelCasePrefixRegex);

	// Affix routing
	if (sepSuffixMatch && sepSuffixMatch[0].length < basename.length) {
		const suffix = sepSuffixMatch[1].toLowerCase();
		mappedService = lowerCaseMap[suffix];
		matchedLength = sepSuffixMatch[0].length;
		if (!isInit && serviceAliases.has(suffix)) {
			environment = suffix;
		}
	} else if (pascalSuffixMatch && pascalSuffixMatch[0].length < basename.length) {
		const suffix = pascalSuffixMatch[1].toLowerCase();
		mappedService = mergedServices[pascalSuffixMatch[1]];
		matchedLength = pascalSuffixMatch[0].length;
		if (!isInit && serviceAliases.has(suffix)) {
			environment = suffix;
		}
	} else if (sepPrefixMatch && sepPrefixMatch[0].length < basename.length) {
		const prefix = sepPrefixMatch[1].toLowerCase();
		mappedService = lowerCaseMap[prefix];
		matchedLength = sepPrefixMatch[0].length; 
		if (!isInit && serviceAliases.has(prefix)) {
			environment = prefix;
		}
		isPrefix = true;
	} else if (camelPrefixMatch && camelPrefixMatch[0].length < basename.length) {
		const prefix = camelPrefixMatch[1].toLowerCase();
		mappedService = lowerCaseMap[prefix];
		matchedLength = camelPrefixMatch[1].length;
		if (!isInit && serviceAliases.has(prefix)) {
			environment = prefix;
		}
		isPrefix = true;
	}

	if (mappedService) {
		targetService = mappedService;
	}

	// Resolve namespace wrapper folder
	let wrapperFolder = "shared";
	if (serverContainers.has(targetService)) wrapperFolder = "server";
	else if (clientContainers.has(targetService)) wrapperFolder = "client";
	else if (environment) wrapperFolder = environment;

	// Scripts with non-legacy RunContext run incorrectly in StarterPlayer container
	const isStarterPlayerContainer = targetService === "StarterPlayerScripts" || targetService === "StarterCharacterScripts";
	if (emitLegacyScripts === false && isStarterPlayerContainer) {
		targetService = "ReplicatedStorage";
	}

	let nodeName = basename;
	let projectPath: string;;

	if (isInit) {
		const folderRelativePath = path.dirname(relativePath);
		projectPath = toPosix(path.join(build, folderRelativePath));
		if (virtualParts.length > 0) nodeName = virtualParts.pop()!;
		else nodeName = lastRouteKeyword ? lastRouteKeyword : "source";
	} else {
		let compiledRelativePath = relativePath;
		if (isTsProject) {
			const compiledFilename = filename.replace(/\.tsx?$/i, ".luau");
			compiledRelativePath = path.join(path.dirname(relativePath), compiledFilename);
		}
		projectPath = toPosix(path.join(build, compiledRelativePath));

		if (mappedService) {
			let shouldStrip = !keepRouteNames;

			// Rojo relies on '.server' and '.client' explicitly for script types.
			// Even if keepRouteNames is true, we must strip these exact dot-prefixes.
			if (keepRouteNames && sepSuffixMatch) {
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