import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { Target, parseTarget } from "../roblox/target.js";
import {
	RojoScriptSuffix,
	rojoAssignedName,
	rojoScriptSuffix,
} from "../rojo/rojo-assigned-name.js";
import {
	SuffixForm,
	SuffixSpan,
	matchFolderKey,
	matchMarkerKey,
	matchSuffixKeys,
} from "./declared-key.js";
import { ScannedEntry, ScannedRoot } from "./root-scanner.js";
import { RouteDiagnostics } from "./route-diagnostics.js";

const FALLBACK_ROUTE = "*";
const INVISIBLE_FOLDER = /^\(.+\)$/;

export type TagForm = "folder" | "marker" | SuffixForm;

export interface TagMatch {
	readonly tag: string;
	readonly form: TagForm;
}

export interface RoutedFile {
	readonly entry: ScannedEntry;
	/** The service, the target's folders, the file's own folders, then the instance name. */
	readonly instancePath: readonly string[];
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
	const context: RouteContext = {
		routeKeys,
		tagKeys,
		declaredKeys: new Set([...routeKeys, ...tagKeys]),
		targets,
	};

	const routed: RoutedFile[] = [];
	const unrouted: string[] = [];
	for (const root of roots) {
		const markers = markersByDir(root);
		for (const entry of root.entries) {
			const outcome = routeEntry(entry, markers, context);
			if (outcome) routed.push({ entry, ...outcome });
			else
				unrouted.push(
					toPosix(path.join(root.rootDir, entry.relativePath))
				);
		}
	}

	return ok({
		routed,
		unrouted,
		warnings:
			unrouted.length > 0
				? [RouteDiagnostics.unrouted(location, unrouted)]
				: [],
	});
}

/** Marker file names per directory, both relative to the root dir; the root itself is "". */
function markersByDir(root: ScannedRoot): ReadonlyMap<string, string[]> {
	const byDir = new Map<string, string[]>();
	for (const marker of root.markers) {
		const dir = path.posix.dirname(marker);
		const key = dir === "." ? "" : dir;
		byDir.set(key, [
			...(byDir.get(key) ?? []),
			path.posix.basename(marker),
		]);
	}
	return byDir;
}

function routeEntry(
	entry: ScannedEntry,
	markers: ReadonlyMap<string, string[]>,
	context: RouteContext
): RouteOutcome | undefined {
	const segments = entry.relativePath.split("/");
	const leaf = segments.pop() as string;

	let governing: string | undefined;
	const tags: TagMatch[] = [];
	const applyMarkers = (dir: string) => {
		for (const fileName of markers.get(dir) ?? []) {
			const key = matchMarkerKey(fileName, context.declaredKeys);
			if (key === undefined) continue;
			if (context.tagKeys.has(key))
				tags.push({ tag: key, form: "marker" });
			else governing ??= key;
		}
	};

	applyMarkers("");
	const folders: string[] = [];
	let dir = "";
	for (const segment of segments) {
		dir = dir ? `${dir}/${segment}` : segment;
		const routeKey = matchFolderKey(segment, context.routeKeys);
		const tagKey = matchFolderKey(segment, context.tagKeys);
		if (routeKey) governing ??= routeKey;
		else if (tagKey) tags.push({ tag: tagKey, form: "folder" });
		else if (!INVISIBLE_FOLDER.test(segment)) folders.push(segment);
		applyMarkers(dir);
	}

	let name = leaf;
	let buriedScriptSuffix: RojoScriptSuffix | undefined;
	if (entry.kind === "init-folder") {
		const match = matchSuffixKeys(
			stemOf(entry.initFile),
			context.declaredKeys
		);
		governing ??= match.spans.find((span) =>
			context.routeKeys.has(span.key)
		)?.key;
		tags.push(...tagSpansOf(match.spans, context).map(asTagMatch));
	} else {
		const stem = stemOf(leaf);
		const match = matchSuffixKeys(stem, context.declaredKeys);
		const tagSpans = tagSpansOf(match.spans, context);
		tags.push(...tagSpans.map(asTagMatch));

		const stripped = [...tagSpans];
		const routeSpan = governing
			? undefined
			: match.spans.find((span) => context.routeKeys.has(span.key));
		if (routeSpan) {
			governing = routeSpan.key;
			stripped.push(routeSpan);
		}
		if (entry.kind === "script") {
			if (tagSpans.length > 0 && !rojoScriptSuffix(stem))
				buriedScriptSuffix = rojoScriptSuffix(
					stripSpans(stem, tagSpans)
				);
		}
		name = stripSpans(stem, stripped);
		if (entry.kind === "script") name = rojoAssignedName(name);
	}

	const target = context.targets.get(governing ?? FALLBACK_ROUTE);
	if (!target) return undefined;
	return {
		instancePath: [target.service, ...target.folders, ...folders, name],
		tags,
		buriedScriptSuffix,
	};
}

function tagSpansOf(
	spans: readonly SuffixSpan[],
	context: RouteContext
): SuffixSpan[] {
	return spans.filter((span) => context.tagKeys.has(span.key));
}

function asTagMatch(span: SuffixSpan): TagMatch {
	return { tag: span.key, form: span.form };
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

function stemOf(fileName: string): string {
	return fileName.slice(0, fileName.length - path.extname(fileName).length);
}
