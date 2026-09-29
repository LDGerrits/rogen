import path from "path";
import { groupBy } from "../../../../base/collection.js";
import { joinPosix } from "../../../../base/path.js";
import { err, ok } from "../../../../base/result.js";
import { Diagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Target, parseTarget } from "../../../roblox/target.js";
import {
	RojoScriptSuffix,
	rojoAssignedName,
	rojoScriptSuffix,
	suffixSeparator,
} from "../../../rojo/rojo-assigned-name.js";
import { RojoFileKind } from "../../../rojo/rojo-files.js";
import {
	EntryRead,
	FolderNode,
	FolderRead,
	LeftOut,
	MarkerRead,
	MatchForm,
	PlacementStage,
	RoutedFile,
	ScannedEntry,
	ScannedRoot,
	TagMatch,
} from "../../build-record.js";
import {
	FALLBACK_ROUTE,
	SuffixSpan,
	declaredKeysOf,
	withSeparatorSuffix,
} from "../../keys/declared-key.js";
import { RouteDiagnostics } from "../../route-diagnostics.js";

type RouteOutcome = Omit<RoutedFile, "entry">;

interface RouteContext {
	readonly routeKeys: ReadonlySet<string>;
	readonly tagKeys: ReadonlySet<string>;
	readonly markers: ReadonlyMap<string, MarkerRead>;
	readonly targets: ReadonlyMap<string, Target>;
}

/** Finds each scanned file's governing route and instance path; files no route governs are left out. */
export const routeFiles: PlacementStage = (build) => {
	const { config } = build;
	const location = { resource: config.outFile };
	if (Object.keys(config.routes).length === 0)
		return err([RouteDiagnostics.noRoutes({ resource: config.file })]);

	const targets = new Map<string, Target>();
	const errors: Diagnostic[] = [];
	for (const [key, value] of Object.entries(config.routes)) {
		const target = parseTarget(value, location);
		if (target.isOk()) targets.set(key, target.value);
		else errors.push(...target.error);
	}
	if (errors.length > 0) return err(errors);

	const { routeKeys, tagKeys } = declaredKeysOf(config);
	const context: RouteContext = {
		routeKeys,
		tagKeys,
		markers: build.readings.markers,
		targets,
	};

	const routed: RoutedFile[] = [];
	const unrouted: [string, LeftOut][] = [];
	for (const root of build.roots) {
		const markers = markersByDir(root);
		for (const entry of root.entries) {
			const read = build.readings.entries.get(entry.source) as EntryRead;
			const outcome = routeEntry(entry, read, markers, context);
			if (outcome) routed.push({ entry, ...outcome });
			else unrouted.push([entry.source, { status: "unrouted" }]);
		}
	}
	return ok({
		...build,
		routed,
		files: routed,
		leftOut: new Map([...build.leftOut, ...unrouted]),
	});
};

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

interface LeafReading {
	readonly name: string;
	readonly separatorName: string | undefined;
	readonly buriedScriptSuffix: RojoScriptSuffix | undefined;
}

function routeEntry(
	entry: ScannedEntry,
	read: EntryRead,
	markers: ReadonlyMap<string, string[]>,
	context: RouteContext
): RouteOutcome | undefined {
	const leaf = path.posix.basename(entry.relativePath);

	const { claims, folders } = walkFolders(entry, read, markers, context);
	const { name, separatorName, buriedScriptSuffix } = readLeaf(
		entry,
		read,
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
		parent = [...parent, folder.segment];
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
	read: EntryRead,
	markers: ReadonlyMap<string, string[]>,
	context: RouteContext
): { claims: Claims; folders: FolderRead[] } {
	const claims: Claims = { route: undefined, tags: [] };
	const applyMarkers = (dir: string) => {
		for (const fileName of markers.get(dir) ?? []) {
			const key = context.markers.get(
				joinPosix(entry.rootDir, dir, fileName)
			)?.key;
			if (key === undefined) continue;
			if (context.tagKeys.has(key))
				claims.tags.push({ tag: key, form: "marker" });
			else claims.route ??= { key, match: "marker" };
		}
	};

	applyMarkers("");
	const folders: FolderRead[] = [];
	for (const folder of read.folders) {
		if (folder.kind === "route")
			claims.route ??= { key: folder.key, match: "folder" };
		else if (folder.kind === "tag")
			claims.tags.push({ tag: folder.key, form: "folder" });
		else if (!folder.invisible) folders.push(folder);
		applyMarkers(folder.dir);
	}
	return { claims, folders };
}

/** Reads the suffixes of a file, or of an init folder's script, into `claims` and returns the instance name. */
function readLeaf(
	entry: ScannedEntry,
	{ fileName, kind, stem, match }: EntryRead,
	leaf: string,
	claims: Claims,
	context: RouteContext
): LeafReading {
	const isInitFolder = entry.kind === "init-folder";
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
