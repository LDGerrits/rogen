import path from "path";
import { 
	serviceAliases, 
	serverContainers, 
	clientContainers
} from "./constants.js";
import { toPosix } from "./tree.js";
import { Mode } from "./types.js";

export interface SystemFlags {
	isRaw: boolean;
	fullNames: boolean;
}

interface FolderRoutingResult {
	targetService: string;
	virtualParts: string[];
	lastRouteKeyword: string | null;
	environmentKeyword: string | null;
	flags: SystemFlags;
}

export interface RoutingMaps {
	mergedServices: Record<string, string>;
	lowerCaseMap: Record<string, string>;
	separatorSuffixRegex: RegExp;
	pascalCaseSuffixRegex: RegExp;
	separatorPrefixRegex: RegExp;
	camelCasePrefixRegex: RegExp;
}

export interface EnvRegexes {
	suffix: RegExp;
	prefix: RegExp;
	middle: RegExp;
}

export interface RouteContext extends Mode {
	source: string | string[];
	isTsProject: boolean;
	emitLegacyScripts: boolean;
	name: string;
	routingMaps: RoutingMaps;
	fullNames: boolean;
	directoryMarkers: Record<string, string[]>;
	environments: Set<string>;
	activeEnv: Set<string>;
	envRegexes: EnvRegexes[];
}

interface AffixResult {
	mappedService: string;
	matchedLength: number;
	exactMatch: string;
	environmentKeyword?: string;
	isPrefix: boolean;
}

interface RouteResolution {
	targetService: string;
	wrapperFolder: string;
	virtualParts: string[];
	nodeName: string;
	projectPath: string;
	dropped: boolean;
}

function resolveFolderRouting(parts: string[], context: RouteContext): FolderRoutingResult {
	const { routingMaps, directoryMarkers, activeEnv } = context;
	const { lowerCaseMap } = routingMaps;

	const virtualParts: string[] = [];
	
	let targetService = "ReplicatedStorage";
	let lastRouteKeyword: string | null = null;
	let environmentKeyword: string | null = null;

	const flags: SystemFlags = { isRaw: false, fullNames: false };

	// Marker routing
	const rootMarkers = directoryMarkers[""];
	if (rootMarkers) {
		if (rootMarkers.includes("raw")) {
			flags.isRaw = true;
		}
		if (rootMarkers.includes("fullnames")) {
			flags.fullNames = true;	
		}

		if (!flags.isRaw) {
			const routingMarker = rootMarkers.find(m => lowerCaseMap[m]);
			if (routingMarker) {
				targetService = lowerCaseMap[routingMarker];
				lastRouteKeyword = routingMarker;
				if (serviceAliases.has(routingMarker)) environmentKeyword = routingMarker;
			}
		}
	}

	// Folder path routing
	let currentPath = "";
	for (const part of parts) {
		currentPath = currentPath ? `${currentPath}/${part}` : part;
		const lowerPart = part.toLowerCase();
		const markers = directoryMarkers ? directoryMarkers[currentPath] : undefined;

		if (markers) {
			if (markers.includes("raw")) {
				flags.isRaw = true;
			}
			if (markers.includes("fullnames")) {
				flags.fullNames = true;
			}
		}

		if (flags.isRaw) {
			if (!activeEnv.has(lowerPart)) {
				virtualParts.push(part);
			}
			continue;
		}

		const matchedService = lowerCaseMap[lowerPart];

		if (markers) {
			const routingMarker = markers.find(m => lowerCaseMap[m]);
			if (routingMarker) {
				targetService = lowerCaseMap[routingMarker];
				lastRouteKeyword = routingMarker;
				if (serviceAliases.has(routingMarker)) environmentKeyword = routingMarker;
				
				if (!matchedService && !activeEnv.has(lowerPart)) {
					virtualParts.push(part);
				}
				continue;
			}
		}
		
		if (matchedService) {
			targetService = matchedService;
			lastRouteKeyword = lowerPart;
			if (serviceAliases.has(lowerPart)) {
				environmentKeyword = lowerPart;
			}
		} else {
			if (!activeEnv.has(lowerPart)) {
				virtualParts.push(part);
			}
		}
	}

	return { targetService, virtualParts, lastRouteKeyword, environmentKeyword, flags };
}

function resolveAffixes(basename: string, isInit: boolean, routingMaps: RoutingMaps): AffixResult | null {
	const { lowerCaseMap, mergedServices, separatorSuffixRegex, pascalCaseSuffixRegex, separatorPrefixRegex, camelCasePrefixRegex } = routingMaps;

	let match = basename.match(separatorSuffixRegex);
	if (match && match[0].length < basename.length) {
		const suffix = match[1].toLowerCase();
		return {
			mappedService: lowerCaseMap[suffix],
			matchedLength: match[0].length,
			exactMatch: match[0],
			environmentKeyword: (!isInit && serviceAliases.has(suffix)) ? suffix : undefined,
			isPrefix: false
		};
	}

	match = basename.match(pascalCaseSuffixRegex);
	if (match && match[0].length < basename.length) {
		const suffix = match[1].toLowerCase();
		return {
			mappedService: mergedServices[match[1]],
			matchedLength: match[0].length,
			exactMatch: match[0],
			environmentKeyword: (!isInit && serviceAliases.has(suffix)) ? suffix : undefined,
			isPrefix: false
		};
	}

	match = basename.match(separatorPrefixRegex);
	if (match && match[0].length < basename.length) {
		const prefix = match[1].toLowerCase();
		return {
			mappedService: lowerCaseMap[prefix],
			matchedLength: match[0].length,
			exactMatch: match[0],
			environmentKeyword: (!isInit && serviceAliases.has(prefix)) ? prefix : undefined,
			isPrefix: true
		};
	}

	match = basename.match(camelCasePrefixRegex);
	if (match && match[0].length < basename.length) {
		const prefix = match[1].toLowerCase();
		return {
			mappedService: lowerCaseMap[prefix],
			matchedLength: match[1].length,
			exactMatch: match[0],
			environmentKeyword: (!isInit && serviceAliases.has(prefix)) ? prefix : undefined,
			isPrefix: true
		};
	}

	return null;
}

function getWrapperFolder(targetService: string, environmentKeyword: string | null): string {
	if (serverContainers.has(targetService)) return "server";
	if (clientContainers.has(targetService)) return "client";
	if (environmentKeyword) return environmentKeyword;
	return "shared";
}

export function resolveRoute(relativePath: string, isInit: boolean, context: RouteContext): RouteResolution {
	const { emitLegacyScripts, isTsProject, build, routingMaps, fullNames, environments, activeEnv, envRegexes, directoryMarkers } = context;
	const parts = relativePath.split(/[\\/]/);
	const filename = parts.pop()!;
	const rawBasename = path.basename(filename, path.extname(filename));

	let dropped = false;
	
	// Check folder paths and folder marker files
	let currentRel = "";
	for (const part of parts) {
		currentRel = currentRel ? `${currentRel}/${part}` : part;
		const lowerPart = part.toLowerCase();
		
		// Drop if folder name is an inactive env
		if (environments.has(lowerPart) && !activeEnv.has(lowerPart)) {
			dropped = true;
			break;
		}

		// Drop if folder contains an inactive env marker file
		const markers = directoryMarkers?.[currentRel];
		if (markers) {
			for (const m of markers) {
				if (environments.has(m) && !activeEnv.has(m)) {
					dropped = true;
					break;
				}
			}
		}
		if (dropped) break;
	}

	// Check root directory markers for drops
	const rootMarkers = directoryMarkers?.[""];
	if (!dropped && rootMarkers) {
		for (const m of rootMarkers) {
			if (environments.has(m) && !activeEnv.has(m)) {
				dropped = true;
				break;
			}
		}
	}
	
	// Check file affixes
	if (!dropped) {
		const delimiterSplit = rawBasename.split(/[.\-_]/);
		for (const part of delimiterSplit) {
			const lowerPart = part.toLowerCase();
			if (environments.has(lowerPart) && !activeEnv.has(lowerPart)) {
				dropped = true;
				break;
			}
		}
	}

	// Stop processing and flag for removal
	if (dropped) {
		return { targetService: "", wrapperFolder: "", virtualParts: [], nodeName: "", projectPath: "", dropped: true };
	}

	// Strip active environment affixes
	let basename = rawBasename;
	for (const regexSet of envRegexes) {
		while (regexSet.suffix.test(basename)) {
			basename = basename.replace(regexSet.suffix, "");
		}
		while (regexSet.prefix.test(basename)) {
			basename = basename.replace(regexSet.prefix, "");
		}
		while (regexSet.middle.test(basename)) {
			basename = basename.replace(regexSet.middle, "");
		}
	}

	// Folder and marker routing
	const { targetService: folderTarget, virtualParts, lastRouteKeyword, environmentKeyword: folderEnv, flags } = resolveFolderRouting(parts, context);

	// Affix routing
	const affix = flags.isRaw ? null : resolveAffixes(basename, isInit, routingMaps);

	// Resolve overrides
	let targetService = affix?.mappedService ?? folderTarget;
	const environmentKeyword = affix?.environmentKeyword ?? folderEnv;

	// Resolve namespace wrapper folder
	const wrapperFolder = getWrapperFolder(targetService, environmentKeyword);

	// Edge case: Scripts with non-legacy RunContext run incorrectly in StarterPlayer container,
	// hence they need to be put in ReplicatedStorage.
	const isStarterPlayerContainer = targetService === "StarterPlayerScripts" || targetService === "StarterCharacterScripts";
	if (emitLegacyScripts === false && isStarterPlayerContainer) {
		targetService = "ReplicatedStorage";
	}

	// Node naming and path formatting
	let nodeName = basename;
	let projectPath: string;

	if (isInit) {
		const folderRelativePath = path.dirname(relativePath);
		projectPath = toPosix(path.join(build, folderRelativePath));
		
		if (virtualParts.length > 0) {
			nodeName = virtualParts.pop()!;
		} else {
			nodeName = lastRouteKeyword ? lastRouteKeyword : "source";
		}
	} else {
		let compiledRelativePath = relativePath;
		if (isTsProject) {
			const compiledFilename = filename.replace(/\.tsx?$/i, ".luau");
			compiledRelativePath = path.join(path.dirname(relativePath), compiledFilename);
		}
		projectPath = toPosix(path.join(build, compiledRelativePath));

		if (affix) {
			const keepFullNames = fullNames || flags.fullNames;
			let shouldStrip = !keepFullNames;

			// Rojo relies on '.server' and '.client' explicitly for script types.
			// Even if fullNames is true, we must strip these exact dot-prefixes.
			if (keepFullNames) {
				const exactMatch = affix.exactMatch.toLowerCase();
				if (exactMatch === ".server" || exactMatch === ".client") {
					shouldStrip = true;
				}
			}

			if (shouldStrip) {
				if (affix.isPrefix) {
					nodeName = basename.slice(affix.matchedLength);
				} else {
					nodeName = basename.slice(0, -affix.matchedLength); 
				}
			}
		} 
	}

	return { targetService, wrapperFolder, virtualParts, nodeName, projectPath, dropped: false };
}