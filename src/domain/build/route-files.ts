import path from "path";
import { groupBy } from "../../base/collection.js";
import { joinPosix, stemOf } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { instanceKey } from "../rojo/rojo-tree.js";
import { Target, parseTarget } from "../roblox/target.js";
import {
	RojoScriptSuffix,
	rojoAssignedName,
	rojoScriptSuffix,
	stripRojoDataSuffix,
	suffixSeparator,
} from "../rojo/rojo-assigned-name.js";
import { RojoFileKind } from "../rojo/rojo-files.js";
import {
	SuffixForm,
	SuffixMatch,
	SuffixSpan,
	matchFolderKey,
	matchKeyIgnoringCase,
	matchMarkerKey,
	matchSuffixKeys,
	unwrapInvisibleFolder,
	withSeparatorSuffix,
} from "./declared-key.js";
import { ScannedEntry, ScannedRoot } from "./root-scanner.js";
import { diagnosePaths } from "./path-list.js";
import { RouteDiagnostics } from "./route-diagnostics.js";

export const FALLBACK_ROUTE = "*";

/** How a route or tag key matched a file. */
export type MatchForm = "folder" | "marker" | SuffixForm;

/** How the governing route matched the file; `fallback` is the `*` route. */
export type RouteMatch = MatchForm | "fallback";

export interface TagMatch {
	readonly tag: string;
	readonly form: MatchForm;
	/** The file name with a capital suffix written as a separator suffix. */
	readonly separatorName?: string;
}

/** A node one of the file's own folders becomes, with that folder relative to the root dir. */
export interface FolderNode {
	readonly instancePath: readonly string[];
	readonly dir: string;
}

export interface RoutedFile {
	readonly entry: ScannedEntry;
	/** The governing route key, or `*`. */
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** The file name with a capital route suffix written as a separator suffix that Rojo leaves in the name. */
	readonly separatorName?: string;
	/** The service, the target's folders, the file's own folders, then the instance name. */
	readonly instancePath: readonly string[];
	/** Routing, tag and invisible folders name no node, so they have none. */
	readonly folderNodes: readonly FolderNode[];
	/** Tag folders and suffixes are already out of `instancePath`; the tag stage decides what they mean. */
	readonly tags: readonly TagMatch[];
	/** A `.server`/`.client` that a tag suffix follows, which Rojo won't read as a script class. */
	readonly buriedScriptSuffix?: RojoScriptSuffix;
}

export interface RouteResult {
	readonly routed: readonly RoutedFile[];
	/** Absolute POSIX source paths of the files no route governs. */
	readonly unrouted: readonly string[];
	readonly warnings: readonly Diagnostic[];
}

type RouteOutcome = Omit<RoutedFile, "entry">;

interface RouteContext {
	readonly routeKeys: ReadonlySet<string>;
	readonly tagKeys: ReadonlySet<string>;
	readonly declaredKeys: ReadonlySet<string>;
	readonly targets: ReadonlyMap<string, Target>;
	/** Called with the path of a name that only differs from a declared key in letter case. */
	readonly noteNearMiss: (path: string, key: string) => void;
}

/** Files that no route governs are left out and reported in one warning. */
export function routeFiles(
	roots: readonly ScannedRoot[],
	config: Pick<ResolvedConfig, "routes" | "tags" | "outFile">
): Result<RouteResult, Diagnostic[]> {
	const location = { resource: config.outFile };
	const targets = new Map<string, Target>();
	const errors: Diagnostic[] = [];
	for (const [key, value] of Object.entries(config.routes)) {
		const target = parseTarget(value, location);
		if (target.isOk()) targets.set(key, target.value);
		else errors.push(...target.error);
	}
	if (errors.length > 0) return err(errors);

	const routeKeys = new Set(
		Object.keys(config.routes).filter((key) => key !== FALLBACK_ROUTE)
	);
	const tagKeys = new Set(Object.keys(config.tags));
	const nearMisses = new Map<string, string>();
	const context: RouteContext = {
		routeKeys,
		tagKeys,
		declaredKeys: new Set([...routeKeys, ...tagKeys]),
		targets,
		noteNearMiss: (path, key) => nearMisses.set(path, key),
	};

	const routed: RoutedFile[] = [];
	const unrouted: string[] = [];
	for (const root of roots) {
		const markers = markersByDir(root);
		for (const marker of root.markers) {
			const key = matchKeyIgnoringCase(
				path.posix.basename(marker).slice(1),
				context.declaredKeys
			);
			if (key) context.noteNearMiss(joinPosix(root.rootDir, marker), key);
		}
		for (const entry of root.entries) {
			const outcome = routeEntry(entry, markers, context);
			if (outcome) routed.push({ entry, ...outcome });
			else unrouted.push(entry.source);
		}
	}

	const capitalRouted = new Map(
		routed
			.filter(({ separatorName }) => separatorName)
			.map((file) => [file.entry.source, file])
	);
	const shared = [...routeKeys].find((key) => key.toLowerCase() === "shared");
	return ok({
		routed,
		unrouted,
		warnings: [
			...diagnosePaths([...nearMisses.keys()], (resource) => {
				const key = nearMisses.get(resource) as string;
				return RouteDiagnostics.caseMismatch(
					{ resource },
					tagKeys.has(key) ? "tag" : "route",
					key
				);
			}),
			...diagnosePaths([...capitalRouted.keys()], (resource) => {
				const file = capitalRouted.get(resource) as RoutedFile;
				return RouteDiagnostics.capitalSuffix(
					{ resource },
					file.route,
					instanceKey(file.instancePath),
					file.separatorName as string,
					shared
				);
			}),
			...diagnosePaths(unrouted, (resource) =>
				RouteDiagnostics.unrouted({ resource })
			),
		],
	});
}

/** Marker file names per directory, both relative to the root dir; the root itself is "". */
function markersByDir(root: ScannedRoot): ReadonlyMap<string, string[]> {
	return groupBy(
		root.markers,
		(marker) => {
			const dir = path.posix.dirname(marker);
			return dir === "." ? "" : dir;
		},
		(marker) => path.posix.basename(marker)
	);
}

/** What the folders and markers above a file, then its own suffixes, claim for it. */
interface Claims {
	route: { readonly key: string; readonly match: MatchForm } | undefined;
	readonly tags: TagMatch[];
}

interface FolderStep {
	readonly name: string;
	readonly dir: string;
}

interface LeafReading {
	readonly name: string;
	readonly separatorName: string | undefined;
	readonly buriedScriptSuffix: RojoScriptSuffix | undefined;
}

function routeEntry(
	entry: ScannedEntry,
	markers: ReadonlyMap<string, string[]>,
	context: RouteContext
): RouteOutcome | undefined {
	const folderNames = entry.relativePath.split("/");
	const leaf = folderNames.pop() as string;

	const { claims, folders } = walkFolders(
		entry,
		folderNames,
		markers,
		context
	);
	const { name, separatorName, buriedScriptSuffix } = readLeaf(
		entry,
		leaf,
		claims,
		context
	);

	const route = claims.route?.key ?? FALLBACK_ROUTE;
	const target = context.targets.get(route);
	if (!target) return undefined;

	const folderNodes: FolderNode[] = [];
	let parent: readonly string[] = [target.service, ...target.folders];
	for (const folder of folders) {
		parent = [...parent, folder.name];
		folderNodes.push({ instancePath: parent, dir: folder.dir });
	}
	return {
		route,
		routeMatch: claims.route?.match ?? "fallback",
		separatorName,
		instancePath: [...parent, name],
		folderNodes,
		tags: claims.tags,
		buriedScriptSuffix,
	};
}

/** Routing, tag and invisible folders and markers claim the file; every other folder becomes a node. */
function walkFolders(
	entry: ScannedEntry,
	folderNames: readonly string[],
	markers: ReadonlyMap<string, string[]>,
	context: RouteContext
): { claims: Claims; folders: FolderStep[] } {
	const claims: Claims = { route: undefined, tags: [] };
	const applyMarkers = (dir: string) => {
		for (const fileName of markers.get(dir) ?? []) {
			const key = matchMarkerKey(fileName, context.declaredKeys);
			if (key === undefined) continue;
			if (context.tagKeys.has(key))
				claims.tags.push({ tag: key, form: "marker" });
			else claims.route ??= { key, match: "marker" };
		}
	};

	applyMarkers("");
	const folders: FolderStep[] = [];
	let dir = "";
	for (const segment of folderNames) {
		dir = dir ? `${dir}/${segment}` : segment;
		const { name, invisible } = unwrapInvisibleFolder(segment);
		const routeKey = matchFolderKey(name, context.routeKeys);
		const tagKey = matchFolderKey(name, context.tagKeys);
		if (routeKey) claims.route ??= { key: routeKey, match: "folder" };
		else if (tagKey) claims.tags.push({ tag: tagKey, form: "folder" });
		else {
			if (!invisible) folders.push({ name: segment, dir });
			const nearMiss = matchKeyIgnoringCase(name, context.declaredKeys);
			if (nearMiss)
				context.noteNearMiss(joinPosix(entry.rootDir, dir), nearMiss);
		}
		applyMarkers(dir);
	}
	return { claims, folders };
}

/** Reads the suffixes of a file, or of an init folder's script, into `claims` and returns the instance name. */
function readLeaf(
	entry: ScannedEntry,
	leaf: string,
	claims: Claims,
	context: RouteContext
): LeafReading {
	const isInitFolder = entry.kind === "init-folder";
	const fileName = isInitFolder ? entry.initFile : leaf;
	const kind: RojoFileKind = isInitFolder ? "script" : entry.kind;
	const rawStem = stemOf(fileName);
	const stem = kind === "data" ? stripRojoDataSuffix(rawStem) : rawStem;

	const match = matchSuffixKeys(stem, context.declaredKeys);
	noteSuffixNearMiss(entry, match, context);
	const tagSpans = tagSpansOf(match.spans, context);
	claims.tags.push(
		...tagSpans.map((span) => asTagMatch(span, fileName, kind))
	);
	const routeSpan = claims.route
		? undefined
		: match.spans.find((span) => context.routeKeys.has(span.key));
	if (routeSpan) claims.route = { key: routeSpan.key, match: routeSpan.form };
	const separatorName =
		routeSpan && separatorNameOf(fileName, kind, routeSpan);

	if (isInitFolder)
		return { name: leaf, separatorName, buriedScriptSuffix: undefined };

	const buriedScriptSuffix =
		kind === "script" && tagSpans.length > 0 && !rojoScriptSuffix(stem)
			? rojoScriptSuffix(stripSpans(stem, tagSpans))
			: undefined;
	const stripped = stripSpans(
		stem,
		routeSpan ? [...tagSpans, routeSpan] : tagSpans
	);
	return {
		name: kind === "script" ? rojoAssignedName(stripped) : stripped,
		separatorName,
		buriedScriptSuffix,
	};
}

function noteSuffixNearMiss(
	entry: ScannedEntry,
	match: SuffixMatch,
	context: RouteContext
): void {
	if (match.nearMissKey)
		context.noteNearMiss(entry.source, match.nearMissKey);
}

function tagSpansOf(
	spans: readonly SuffixSpan[],
	context: RouteContext
): SuffixSpan[] {
	return spans.filter((span) => context.tagKeys.has(span.key));
}

function asTagMatch(
	span: SuffixSpan,
	fileName: string,
	kind: RojoFileKind
): TagMatch {
	const match = { tag: span.key, form: span.form };
	const separatorName = separatorNameOf(fileName, kind, span);
	return separatorName ? { ...match, separatorName } : match;
}

function separatorNameOf(
	fileName: string,
	kind: RojoFileKind,
	span: SuffixSpan
): string | undefined {
	return span.form === "capital"
		? withSeparatorSuffix(fileName, span, suffixSeparator(kind, span.key))
		: undefined;
}

/** Keeps the stem whole rather than return an empty name. */
function stripSpans(stem: string, spans: readonly SuffixSpan[]): string {
	const stripped = [...spans]
		.sort((a, b) => b.start - a.start)
		.reduce(
			(name, span) =>
				name.slice(0, span.start) +
				name.slice(span.start + span.length),
			stem
		);
	return stripped || stem;
}
