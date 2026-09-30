import path from "path";
import { compareStrings, groupBy } from "../../base/collection.js";
import { isMatch } from "../../base/glob.js";
import { joinPosix, stemOf, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { Target } from "../roblox/roblox.js";
import { RojoFile, RojoFileKind, RojoScriptSuffix } from "../rojo/rojo-file.js";
import { RojoProject, instanceKey } from "../rojo/rojo-project.js";
import { SyncTool } from "../toolchain/toolchain.js";
import {
	EntryRead,
	FolderNode,
	FolderRead,
	InstanceClash,
	LeftOut,
	MarkerRead,
	MatchForm,
	PathReadings,
	PlacedBuild,
	PreparedBuild,
	RoutedFile,
	ScanLeftOut,
	ScannedEntry,
	ScannedRoot,
	TagMatch,
} from "./build-record.js";
import {
	FALLBACK_ROUTE,
	SuffixSpan,
	declaredKeysOf,
	matchKeyIgnoringCase,
	matchMarkerKey,
	matchSuffixKeys,
	readFolderName,
	withSeparatorSuffix,
} from "./declared-keys.js";
import { syncLayoutOf } from "./sync-layout.js";
import { templateProject } from "./template.js";

/** Where every scanned file lands, or why it lands nowhere. */
export function placeFiles(
	index: IndexReader,
	config: ResolvedConfig,
	tools: readonly SyncTool[]
): Result<PlacedBuild, Diagnostic[]> {
	return prepareBuild(index, config, tools).flatMap(place);
}

function place(prepared: PreparedBuild): Result<PlacedBuild, Diagnostic[]> {
	const roots = scanRoots(prepared);
	const readings = readPaths(prepared, roots);
	const routing = routeFiles(prepared, roots, readings);
	const tagging = applyTags(prepared, routing.routed);
	if (tagging.isErr()) return tagging;
	const templating = yieldToTemplate(prepared, tagging.value.files);

	return ok({
		...prepared,
		roots,
		readings,
		routed: routing.routed,
		files: templating.files,
		clashes: tagging.value.clashes,
		leftOut: new Map([
			...roots.flatMap((root) => [...root.leftOut]),
			...routing.leftOut,
			...tagging.value.leftOut,
			...templating.leftOut,
		]),
	});
}

/** One error per config that declares no routes, since nothing could be placed. */
export function findConfigsWithoutRoutes(
	configs: readonly Pick<ResolvedConfig, "file" | "routes">[]
): Diagnostic[] {
	return configs
		.filter(({ routes }) => Object.keys(routes).length === 0)
		.map(({ file }) =>
			errorDiagnostic(
				"route.noRoutes",
				{ resource: file },
				'no routes declared, so nothing can be placed.\nAdd a "routes" map — `rogen init` writes a starting set.'
			)
		);
}

/** Settles everything the config decides, and fails on a config that can't build, before any file is scanned. */
function prepareBuild(
	index: IndexReader,
	config: ResolvedConfig,
	tools: readonly SyncTool[]
): Result<PreparedBuild, Diagnostic[]> {
	const withoutRoutes = findConfigsWithoutRoutes([config]);
	if (withoutRoutes.length > 0) return err(withoutRoutes);

	const targets = new Map<string, Target>();
	const errors: Diagnostic[] = [];
	for (const [key, value] of Object.entries(config.routes)) {
		const target = Target.parse(value, { resource: config.outFile });
		if (target.isOk()) targets.set(key, target.value);
		else errors.push(...target.error);
	}
	if (errors.length > 0) return err(errors);

	const layout = syncLayoutOf(config, tools);
	return ok({
		config,
		index,
		layout,
		template: templateProject(config, layout.projectDir),
		keys: declaredKeysOf(config),
		targets,
	});
}

/** Reads the root dirs from the index, in `rootDirs` order, which decides clashes between them. */
function scanRoots({
	config,
	index,
}: Pick<PreparedBuild, "config" | "index">): ScannedRoot[] {
	return config.rootDirs.map(
		(rootDir) =>
			scanRoot(index, rootDir, config.exclude) ?? emptyRoot(rootDir)
	);
}

function emptyRoot(rootDir: string): ScannedRoot {
	return {
		rootDir,
		exists: false,
		entries: [],
		markers: [],
		metaFiles: [],
		leftOut: new Map(),
	};
}

function scanRoot(
	index: IndexReader,
	rootDir: string,
	exclude: readonly string[]
): ScannedRoot | undefined {
	const entries: ScannedEntry[] = [];
	const markers: string[] = [];
	const metaFiles: string[] = [];
	const leftOut = new Map<string, ScanLeftOut>();

	const excludingGlob = (absolutePath: string) => {
		const posixPath = toPosix(absolutePath);
		return exclude.find((glob) => isMatch(posixPath, glob));
	};

	const visit = (dir: string): boolean => {
		const listing = index.getEntries(dir);
		if (!listing) return false;

		const relativeDir = toPosix(path.relative(rootDir, dir));
		const relativeTo = (name: string) =>
			relativeDir ? `${relativeDir}/${name}` : name;

		const kept: [string, FileType][] = [];
		for (const [name, type] of listing) {
			const glob = excludingGlob(path.join(dir, name));
			if (glob)
				leftOut.set(joinPosix(dir, name), {
					status: "excluded",
					pattern: glob,
				});
			else kept.push([name, type]);
		}

		const initFile = kept
			.filter(
				([name, type]) =>
					isFileType(type) && new RojoFile(name).isInitScript
			)
			.map(([name]) => name)
			.sort()[0];
		if (initFile && relativeDir) {
			if (kept.some(([name]) => name === RojoFile.INIT_META))
				metaFiles.push(relativeTo(RojoFile.INIT_META));
			entries.push({
				kind: "init-folder",
				rootDir,
				relativePath: relativeDir,
				source: joinPosix(rootDir, relativeDir),
				initFile,
			});
			return true;
		}

		const subdirs: string[] = [];
		for (const [name, type] of kept) {
			if (type === FileType.SymbolicLink) {
				leftOut.set(joinPosix(dir, name), { status: "skipped" });
			} else if (isDirectoryType(type)) {
				subdirs.push(path.join(dir, name));
			} else {
				// A key can't contain a dot, so a dot-file with a file type is never a marker.
				const file = new RojoFile(name);
				const kind = file.kind;
				if (file.isMeta) {
					metaFiles.push(relativeTo(name));
				} else if (kind) {
					entries.push({
						kind,
						rootDir,
						relativePath: relativeTo(name),
						source: joinPosix(dir, name),
					});
				} else if (name.startsWith(".")) {
					markers.push(relativeTo(name));
				}
			}
		}

		subdirs.forEach(visit);
		return true;
	};

	if (!visit(rootDir)) return undefined;

	return {
		rootDir,
		exists: true,
		entries: entries.sort(byRelativePath),
		markers: markers.sort(),
		metaFiles: metaFiles.sort(),
		leftOut,
	};
}

function byRelativePath(a: ScannedEntry, b: ScannedEntry): number {
	return compareStrings(a.relativePath, b.relativePath);
}

/** Reads every folder, marker and suffix against the declared keys, once, for the stages and rules after it. */
function readPaths(
	{ keys }: Pick<PreparedBuild, "keys">,
	roots: readonly ScannedRoot[]
): PathReadings {
	const { routeKeys, tagKeys, all } = keys;
	const folders = new Map<string, FolderRead>();
	const markers = new Map<string, MarkerRead>();
	const entries = new Map<string, EntryRead>();

	const folderAt = (rootDir: string, dir: string): FolderRead => {
		const key = joinPosix(rootDir, dir);
		let read = folders.get(key);
		if (!read) {
			const segment = path.posix.basename(dir);
			const reading = readFolderName(segment, routeKeys, tagKeys);
			read = {
				...reading,
				segment,
				dir,
				nearMissKey:
					reading.kind === "plain"
						? matchKeyIgnoringCase(reading.name, all)
						: undefined,
			};
			folders.set(key, read);
		}
		return read;
	};

	const readFoldersAbove = (rootDir: string, relativePath: string) => {
		const above: FolderRead[] = [];
		let dir = "";
		for (const segment of relativePath.split("/").slice(0, -1)) {
			dir = dir ? `${dir}/${segment}` : segment;
			above.push(folderAt(rootDir, dir));
		}
		return above;
	};

	for (const root of roots) {
		for (const marker of root.markers) {
			readFoldersAbove(root.rootDir, marker);
			const name = path.posix.basename(marker);
			markers.set(joinPosix(root.rootDir, marker), {
				key: matchMarkerKey(name, all),
				nearMissKey: matchKeyIgnoringCase(name.slice(1), all),
			});
		}
		for (const metaFile of root.metaFiles)
			readFoldersAbove(root.rootDir, metaFile);
		for (const entry of root.entries) {
			const { fileName, kind, stem } = suffixedNameOf(entry);
			entries.set(entry.source, {
				folders: readFoldersAbove(root.rootDir, entry.relativePath),
				fileName,
				kind,
				stem,
				match: matchSuffixKeys(stem, all),
			});
		}
	}
	return { folders, markers, entries };
}

function suffixedNameOf(entry: ScannedEntry): {
	readonly fileName: string;
	readonly kind: RojoFileKind;
	readonly stem: string;
} {
	const isInitFolder = entry.kind === "init-folder";
	const fileName = isInitFolder
		? entry.initFile
		: path.posix.basename(entry.relativePath);
	const kind: RojoFileKind = isInitFolder ? "script" : entry.kind;
	const stem = stemOf(fileName);
	return {
		fileName,
		kind,
		stem: kind === "data" ? RojoFile.dataNameOf(stem) : stem,
	};
}

type RouteOutcome = Omit<RoutedFile, "entry">;

interface RouteContext {
	readonly routeKeys: ReadonlySet<string>;
	readonly tagKeys: ReadonlySet<string>;
	readonly markers: ReadonlyMap<string, MarkerRead>;
	readonly targets: ReadonlyMap<string, Target>;
}

interface Routing {
	/** Every file a route governs, in scan order. */
	readonly routed: readonly RoutedFile[];
	/** The files no route governs. */
	readonly leftOut: ReadonlyMap<string, LeftOut>;
}

/** Finds each scanned file's governing route and instance path; files no route governs are left out. */
function routeFiles(
	{ keys, targets }: Pick<PreparedBuild, "keys" | "targets">,
	roots: readonly ScannedRoot[],
	readings: PathReadings
): Routing {
	const context: RouteContext = {
		routeKeys: keys.routeKeys,
		tagKeys: keys.tagKeys,
		markers: readings.markers,
		targets,
	};

	const routed: RoutedFile[] = [];
	const leftOut = new Map<string, LeftOut>();
	for (const root of roots) {
		const markers = markersByDir(root);
		for (const entry of root.entries) {
			const read = readings.entries.get(entry.source) as EntryRead;
			const outcome = routeEntry(entry, read, markers, context);
			if (outcome) routed.push({ entry, ...outcome });
			else leftOut.set(entry.source, { status: "unrouted" });
		}
	}
	return { routed, leftOut };
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
	claims.tags.push(...tagSpans.map((span) => asTagMatch(span, fileName)));
	const routeSpan = claims.route
		? undefined
		: match.spans.find((span) => context.routeKeys.has(span.key));
	if (routeSpan) claims.route = { key: routeSpan.key, match: routeSpan.form };
	const separatorName = routeSpan && separatorNameOf(fileName, routeSpan);

	if (isInitFolder)
		return { name: leaf, separatorName, buriedScriptSuffix: undefined };

	const buriedScriptSuffix =
		kind === "script" &&
		tagSpans.length > 0 &&
		!RojoFile.scriptSuffixOf(stem)
			? RojoFile.scriptSuffixOf(stripSpans(stem, tagSpans))
			: undefined;
	const stripped = stripSpans(
		stem,
		routeSpan ? [...tagSpans, routeSpan] : tagSpans
	);
	return {
		name: kind === "script" ? RojoFile.scriptNameOf(stripped) : stripped,
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

function asTagMatch(span: SuffixSpan, fileName: string): TagMatch {
	const match = { tag: span.key, form: span.form };
	const separatorName = separatorNameOf(fileName, span);
	return separatorName ? { ...match, separatorName } : match;
}

function separatorNameOf(
	fileName: string,
	span: SuffixSpan
): string | undefined {
	return span.form === "capital"
		? withSeparatorSuffix(
				fileName,
				span,
				new RojoFile(fileName).suffixSeparator(span.key)
			)
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

interface Tagging {
	/** Every instance path appears once per build; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** The files pruned by a dormant tag and those another file replaced. */
	readonly leftOut: ReadonlyMap<string, LeftOut>;
	readonly clashes: readonly InstanceClash[];
}

/** Prunes what dormant tags remove, then resolves files that share an instance path. */
function applyTags(
	{ config }: Pick<PreparedBuild, "config">,
	routed: readonly RoutedFile[]
): Result<Tagging, Diagnostic[]> {
	const leftOut = new Map<string, LeftOut>();
	const kept: RoutedFile[] = [];
	for (const file of routed) {
		const dormant = file.tags.filter(({ tag }) => !config.tags[tag]);
		if (dormant.length === 0) kept.push(file);
		else
			leftOut.set(file.entry.source, { status: "pruned", tags: dormant });
	}

	const errors: Diagnostic[] = [];
	const clashes: InstanceClash[] = [];
	const winners = new Map<string, RoutedFile>();
	for (const root of groupBy(kept, (file) => file.entry.rootDir).values()) {
		for (const [instance, claimants] of groupBy(root, (file) =>
			instanceKey(file.instancePath)
		)) {
			const tagged = claimants.filter((file) => file.tags.length > 0);
			const untagged = claimants.filter((file) => file.tags.length === 0);
			if (tagged.length > 1)
				errors.push(
					errorDiagnostic(
						"tag.activeClash",
						{ resource: config.outFile },
						`${tagged.length} files with active tags all become "${instance}" (${tagged.map(({ entry }) => entry.source).join(", ")}). Only one can apply: turn a tag off or rename a file.`
					)
				);
			else if (claimants.length > 1)
				clashes.push({ instance, claimants });
			winners.set(instance, tagged[0] ?? untagged[untagged.length - 1]);
		}
	}
	if (errors.length > 0) return err(errors);

	for (const file of kept) {
		const winner = winners.get(instanceKey(file.instancePath));
		if (winner && winner !== file)
			leftOut.set(file.entry.source, {
				status: "replaced",
				by: winner.entry.source,
			});
	}
	return ok({ files: [...new Set(winners.values())], leftOut, clashes });
}

interface TemplateYield {
	readonly files: readonly RoutedFile[];
	readonly leftOut: ReadonlyMap<string, LeftOut>;
}

/** Leaves out the files whose node the template already defines; the template wins. */
function yieldToTemplate(
	{ template }: Pick<PreparedBuild, "template">,
	placed: readonly RoutedFile[]
): TemplateYield {
	const files: RoutedFile[] = [];
	const leftOut = new Map<string, LeftOut>();
	for (const file of placed) {
		const node = displacingNode(template, file);
		if (node) leftOut.set(file.entry.source, { status: "displaced", node });
		else files.push(file);
	}
	return { files, leftOut };
}

/** The file's own node, or a folder of its that the template gives a `$path`, which is that folder's whole content. */
function displacingNode(
	template: RojoProject,
	file: RoutedFile
): readonly string[] | undefined {
	const folder = file.folderNodes.find(
		({ instancePath }) =>
			template.getNode(instancePath)?.$path !== undefined
	);
	if (folder) return folder.instancePath;
	return template.getNode(file.instancePath) ? file.instancePath : undefined;
}
