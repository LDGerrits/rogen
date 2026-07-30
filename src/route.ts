import path from "path";
import {
	serviceAliases,
	serverContainers,
	clientContainers,
} from "./constants.js";
import { toPosix } from "./tree.js";
import { Mode } from "./types.js";

export interface SystemMarkers {
	structure: "structure";
	verbatim: "verbatim";
	unwrap: "unwrap";
}

export type SystemFlags = {
	[K in keyof SystemMarkers]: boolean;
};

interface FolderRoutingResult {
	targetService: string;
	virtualParts: string[];
	lastRouteKeyword: string | null;
	tagKeyword: string | null;
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

export interface TagRegexes {
	suffix: RegExp;
	prefix: RegExp;
	middle: RegExp;
}

export interface RouteContext extends Omit<Mode, "tags"> {
	source: string | string[];
	isTsProject: boolean;
	emitLegacyScripts: boolean;
	name: string;
	routingMaps: RoutingMaps;
	verbatim: boolean;
	unwrap: boolean;
	directoryMarkers: Record<string, string[]>;
	knownTags: Set<string>;
	activeTags: Set<string>;
	tagRegexes: TagRegexes[];
}

interface AffixResult {
	mappedService: string;
	matchedLength: number;
	exactMatch: string;
	tagKeyword?: string;
	isPrefix: boolean;
}

interface RouteResolution {
	targetService: string;
	wrapperFolder: string;
	virtualParts: string[];
	nodeName: string;
	projectPath: string;
	dropped: boolean;
	unwrap: boolean;
}

function resolveFolderRouting(
	parts: string[],
	context: RouteContext
): FolderRoutingResult {
	const { routingMaps, directoryMarkers, activeTags } = context;
	const { lowerCaseMap } = routingMaps;

	const virtualParts: string[] = [];

	let targetService = "ReplicatedStorage";
	let lastRouteKeyword: string | null = null;
	let tagKeyword: string | null = null;

	const flags: SystemFlags = {
		structure: false,
		verbatim: false,
		unwrap: false,
	};

	// Marker routing
	const rootMarkers = directoryMarkers[""];
	if (rootMarkers) {
		if (rootMarkers.includes("structure")) {
			flags.structure = true;
		}
		if (rootMarkers.includes("verbatim")) {
			flags.verbatim = true;
		}
		if (rootMarkers.includes("unwrap")) {
			flags.unwrap = true;
		}

		if (!flags.structure) {
			const routingMarker = rootMarkers.find((m) => lowerCaseMap[m]);
			if (routingMarker) {
				targetService = lowerCaseMap[routingMarker];
				lastRouteKeyword = routingMarker;
				if (serviceAliases.has(routingMarker))
					tagKeyword = routingMarker;
			}
		}
	}

	// Folder path routing
	let currentPath = "";
	for (const part of parts) {
		currentPath = currentPath ? `${currentPath}/${part}` : part;
		let lowerPart = part.toLowerCase();

		let isInvisible = false;
		if (lowerPart.startsWith("(") && lowerPart.endsWith(")")) {
			isInvisible = true;
			lowerPart = lowerPart.slice(1, -1);
		}

		const markers = directoryMarkers
			? directoryMarkers[currentPath]
			: undefined;

		if (markers) {
			if (markers.includes("structure")) {
				flags.structure = true;
			}
			if (markers.includes("verbatim")) {
				flags.verbatim = true;
			}
			if (markers.includes("unwrap")) {
				flags.unwrap = true;
			}
		}

		if (flags.structure) {
			if (!activeTags.has(lowerPart)) {
				virtualParts.push(part);
			}
			continue;
		}

		const matchedService = lowerCaseMap[lowerPart];

		if (markers) {
			const routingMarker = markers.find((m) => lowerCaseMap[m]);
			if (routingMarker) {
				targetService = lowerCaseMap[routingMarker];
				lastRouteKeyword = routingMarker;
				if (serviceAliases.has(routingMarker))
					tagKeyword = routingMarker;

				if (
					!matchedService &&
					!activeTags.has(lowerPart) &&
					!isInvisible
				) {
					virtualParts.push(part);
				}
				continue;
			}
		}

		if (matchedService) {
			targetService = matchedService;
			lastRouteKeyword = lowerPart;
			if (serviceAliases.has(lowerPart)) {
				tagKeyword = lowerPart;
			}
		} else {
			if (!activeTags.has(lowerPart) && !isInvisible) {
				virtualParts.push(part);
			}
		}
	}

	return {
		targetService,
		virtualParts,
		lastRouteKeyword,
		tagKeyword,
		flags,
	};
}

function resolveAffixes(
	basename: string,
	isInit: boolean,
	routingMaps: RoutingMaps
): AffixResult | null {
	const {
		lowerCaseMap,
		mergedServices,
		separatorSuffixRegex,
		pascalCaseSuffixRegex,
		separatorPrefixRegex,
		camelCasePrefixRegex,
	} = routingMaps;

	let match = basename.match(separatorSuffixRegex);
	if (match && match[0].length < basename.length) {
		const suffix = match[1].toLowerCase();
		return {
			mappedService: lowerCaseMap[suffix],
			matchedLength: match[0].length,
			exactMatch: match[0],
			tagKeyword:
				!isInit && serviceAliases.has(suffix) ? suffix : undefined,
			isPrefix: false,
		};
	}

	match = basename.match(pascalCaseSuffixRegex);
	if (match && match[0].length < basename.length) {
		const suffix = match[1].toLowerCase();
		return {
			mappedService: mergedServices[match[1]],
			matchedLength: match[0].length,
			exactMatch: match[0],
			tagKeyword:
				!isInit && serviceAliases.has(suffix) ? suffix : undefined,
			isPrefix: false,
		};
	}

	match = basename.match(separatorPrefixRegex);
	if (match && match[0].length < basename.length) {
		const prefix = match[1].toLowerCase();
		return {
			mappedService: lowerCaseMap[prefix],
			matchedLength: match[0].length,
			exactMatch: match[0],
			tagKeyword:
				!isInit && serviceAliases.has(prefix) ? prefix : undefined,
			isPrefix: true,
		};
	}

	match = basename.match(camelCasePrefixRegex);
	if (match && match[0].length < basename.length) {
		const prefix = match[1].toLowerCase();
		return {
			mappedService: lowerCaseMap[prefix],
			matchedLength: match[1].length,
			exactMatch: match[0],
			tagKeyword:
				!isInit && serviceAliases.has(prefix) ? prefix : undefined,
			isPrefix: true,
		};
	}

	return null;
}

function getWrapperFolder(
	targetService: string,
	tagKeyword: string | null
): string {
	if (serverContainers.has(targetService)) return "server";
	if (clientContainers.has(targetService)) return "client";
	if (tagKeyword) return tagKeyword;
	return "shared";
}

export function resolveRoute(
	relativePath: string,
	isInit: boolean,
	context: RouteContext,
	isSync = false
): RouteResolution {
	const {
		emitLegacyScripts,
		isTsProject,
		build,
		routingMaps,
		verbatim,
		knownTags,
		activeTags,
		tagRegexes,
		directoryMarkers,
	} = context;

	const parts = relativePath ? relativePath.split(/[\\/]/) : [];
	let filename = "";
	let rawBasename = "";

	if (isSync) {
		filename = parts.length > 0 ? parts[parts.length - 1] : "";
		rawBasename = filename;
	} else {
		filename = parts.length > 0 ? parts.pop()! : "";
		rawBasename = filename
			? path.basename(filename, path.extname(filename))
			: "";
	}

	// Detect and strip the hoisting prefix
	let isHoisted = false;
	let cleanBasename = rawBasename;
	if (cleanBasename.startsWith("^")) {
		isHoisted = true;
		cleanBasename = cleanBasename.slice(1);
	}

	let dropped = false;

	// Check folder paths and folder marker files
	let currentRel = "";
	for (const part of parts) {
		currentRel = currentRel ? `${currentRel}/${part}` : part;
		let lowerPart = part.toLowerCase();

		// Strip invisible folder syntax for drop checks
		if (lowerPart.startsWith("(") && lowerPart.endsWith(")")) {
			lowerPart = lowerPart.slice(1, -1);
		}

		// Drop if folder name is an inactive env
		if (knownTags.has(lowerPart) && !activeTags.has(lowerPart)) {
			dropped = true;
			break;
		}

		// Drop if folder contains an inactive env marker file
		const markers = directoryMarkers?.[currentRel];
		if (markers) {
			for (const m of markers) {
				if (knownTags.has(m) && !activeTags.has(m)) {
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
			if (knownTags.has(m) && !activeTags.has(m)) {
				dropped = true;
				break;
			}
		}
	}

	// Check file affixes
	if (!dropped && !isSync && cleanBasename) {
		const delimiterSplit = cleanBasename.split(/[.\-_+]/);
		for (const part of delimiterSplit) {
			const lowerPart = part.toLowerCase();
			if (knownTags.has(lowerPart) && !activeTags.has(lowerPart)) {
				dropped = true;
				break;
			}
		}
	}

	// Stop processing and flag for removal
	if (dropped) {
		return {
			targetService: "",
			wrapperFolder: "",
			virtualParts: [],
			nodeName: "",
			projectPath: "",
			dropped: true,
			unwrap: false,
		};
	}

	// Strip active environment affixes
	let basename = cleanBasename;
	if (!isSync) {
		for (const regexSet of tagRegexes) {
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
	}

	// Folder and marker routing
	const {
		targetService: folderTarget,
		virtualParts,
		lastRouteKeyword,
		tagKeyword: folderFlag,
		flags,
	} = resolveFolderRouting(parts, context);

	// Apply hoisting
	if (isHoisted) {
		virtualParts.length = 0;
	}

	// Affix routing
	const affix =
		flags.structure || isSync
			? null
			: resolveAffixes(basename, isInit, routingMaps);

	// Resolve overrides
	let targetService = affix?.mappedService ?? folderTarget;
	const tagKeyword = affix?.tagKeyword ?? folderFlag;

	// Resolve namespace wrapper folder
	const wrapperFolder = getWrapperFolder(targetService, tagKeyword);

	// Determine if the wrapper folder should be skipped
	const unwrap = context.unwrap || flags.unwrap;

	// Edge case: Scripts with non-legacy RunContext run incorrectly in StarterPlayer container,
	// hence they need to be put in ReplicatedStorage.
	const isStarterPlayerContainer =
		targetService === "StarterPlayerScripts" ||
		targetService === "StarterCharacterScripts";
	if (emitLegacyScripts === false && isStarterPlayerContainer) {
		targetService = "ReplicatedStorage";
	}

	// Node naming and path formatting
	let nodeName = basename;
	let projectPath: string;

	if (isSync) {
		projectPath = toPosix(path.join(build, relativePath));
		if (virtualParts.length > 0) {
			nodeName = virtualParts.pop()!;
		} else {
			nodeName = lastRouteKeyword
				? lastRouteKeyword
				: filename || "source";
		}
	} else if (isInit) {
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
			compiledRelativePath = path.join(
				path.dirname(relativePath),
				compiledFilename
			);
		}
		projectPath = toPosix(path.join(build, compiledRelativePath));

		if (affix) {
			const keepFullNames = verbatim || flags.verbatim;
			let shouldStrip = !keepFullNames;

			// Rojo relies on '.server' and '.client' explicitly for script types.
			// Even if verbatim is true, we must strip these exact dot-prefixes.
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

	return {
		targetService,
		wrapperFolder,
		virtualParts,
		nodeName,
		projectPath,
		dropped: false,
		unwrap,
	};
}
