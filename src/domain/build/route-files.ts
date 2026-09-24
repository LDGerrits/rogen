import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { Target, parseTarget } from "../roblox/target.js";
import { rojoAssignedName } from "../rojo/rojo-assigned-name.js";
import {
	matchFolderKey,
	matchMarkerKey,
	matchSuffixKeys,
} from "./declared-key.js";
import { ScannedEntry, ScannedRoot } from "./root-scanner.js";
import { RouteDiagnostics } from "./route-diagnostics.js";

const FALLBACK_ROUTE = "*";
const LISTED_UNROUTED = 3;
const INVISIBLE_FOLDER = /^\(.+\)$/;

export interface RoutedFile {
	readonly entry: ScannedEntry;
	/** The service, the target's folders, the file's own folders, then the instance name. */
	readonly instancePath: readonly string[];
}

export interface RouteResult {
	readonly routed: readonly RoutedFile[];
	readonly warnings: readonly Diagnostic[];
}

interface RouteContext {
	readonly routeKeys: ReadonlySet<string>;
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
	const context: RouteContext = {
		routeKeys,
		declaredKeys: new Set([...routeKeys, ...Object.keys(config.tags)]),
		targets,
	};

	const routed: RoutedFile[] = [];
	const unrouted: string[] = [];
	for (const root of roots) {
		const markers = markersByDir(root);
		for (const entry of root.entries) {
			const instancePath = routeEntry(entry, markers, context);
			if (instancePath) routed.push({ entry, instancePath });
			else
				unrouted.push(
					toPosix(path.join(root.rootDir, entry.relativePath))
				);
		}
	}

	return ok({
		routed,
		warnings:
			unrouted.length > 0
				? [
						RouteDiagnostics.unrouted(
							location,
							unrouted.length,
							unrouted.slice(0, LISTED_UNROUTED)
						),
					]
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
): string[] | undefined {
	const segments = entry.relativePath.split("/");
	const leaf = segments.pop() as string;

	let governing: string | undefined;
	const markerKey = (dir: string) =>
		(markers.get(dir) ?? [])
			.map((name) => matchMarkerKey(name, context.routeKeys))
			.find((key) => key !== undefined);

	governing ??= markerKey("");
	const folders: string[] = [];
	let dir = "";
	for (const segment of segments) {
		dir = dir ? `${dir}/${segment}` : segment;
		const folderKey = matchFolderKey(segment, context.routeKeys);
		if (folderKey) {
			governing ??= folderKey;
			continue;
		}
		governing ??= markerKey(dir);
		if (!INVISIBLE_FOLDER.test(segment)) folders.push(segment);
	}

	let name: string;
	if (entry.kind === "init-folder") {
		name = leaf;
		governing ??= suffixRoute(stemOf(entry.initFile), context)?.key;
	} else {
		const stem = stemOf(leaf);
		name = stem;
		if (entry.kind === "script") {
			const suffix = governing ? undefined : suffixRoute(stem, context);
			if (suffix) {
				governing = suffix.key;
				name =
					stem.slice(0, suffix.start) +
					stem.slice(suffix.start + suffix.length);
			}
			name = rojoAssignedName(name);
		}
	}

	const target = context.targets.get(governing ?? FALLBACK_ROUTE);
	if (!target) return undefined;
	return [target.service, ...target.folders, ...folders, name];
}

function stemOf(fileName: string): string {
	return fileName.slice(0, fileName.length - path.extname(fileName).length);
}

/** The trailing route key of a name's declared-key suffixes, ignoring tags. */
function suffixRoute(stem: string, context: RouteContext) {
	return matchSuffixKeys(stem, context.declaredKeys).spans.find((span) =>
		context.routeKeys.has(span.key)
	);
}
