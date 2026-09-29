import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { rojoAssignedName, rojoModelName } from "../rojo/rojo-assigned-name.js";
import { containerClassName } from "../roblox/container-class-name.js";
import { RojoNode, RojoTree } from "../rojo/rojo-tree.js";
import { applyFolderMeta } from "./apply-folder-meta.js";
import { FolderMeta } from "./read-folder-meta.js";
import { ScannedEntry } from "./root-scanner.js";
import { RojoProject } from "../rojo/rojo-project.js";
import { RoutedFile } from "./route-files.js";
import { SyncLayout, rebaseTemplatePath, relativeToProject, syncPath } from "./sync-path.js";
import { commonRoot } from "../config/common-root.js";
import { RunContextRoute, TreeDiagnostics } from "./tree-diagnostics.js";

export interface AssemblyInput {
	readonly files: readonly RoutedFile[];
	/** Absolute POSIX source paths Rogen deliberately left out, by reason. */
	readonly excluded: readonly string[];
	readonly pruned: readonly string[];
	readonly unrouted: readonly string[];
	readonly skippedLinks: readonly string[];
	/** Files that lost their instance path to another; they block a collapse but aren't ignored. */
	readonly superseded: readonly string[];
	readonly folderMeta: readonly FolderMeta[];
}

export interface AssemblyOutput {
	readonly value: RojoTree;
	readonly warnings: readonly Diagnostic[];
}

interface PlacedEntry {
	readonly file: RoutedFile;
	readonly source: string;
	readonly rojoName: string;
}

const DECLARATION_FILE = /\.d\.ts$/i;
const INSTANCE_SEPARATOR = "/";
const PLAYER_SCRIPT_CONTAINERS = new Set([
	"StarterPlayerScripts",
	"StarterCharacterScripts",
]);

/** Merges the routed files into the template, collapsing a directory into one `$path` where Rojo would see the same files. */
export function assembleTree(
	config: Pick<
		ResolvedConfig,
		| "name"
		| "rootDirs"
		| "routes"
		| "tags"
		| "template"
		| "syncDir"
		| "outFile"
	>,
	input: AssemblyInput
): Result<AssemblyOutput, Diagnostic[]> {
	const location = { resource: config.outFile };
	const projectDir = path.dirname(config.outFile);
	const layout: SyncLayout = {
		commonRoot: commonRoot(config.rootDirs),
		syncDir: config.syncDir,
		projectDir,
	};
	const warnings: Diagnostic[] = [];

	const runContextRoutes =
		config.template?.project.emitLegacyScripts === false
			? routesIntoPlayerScripts(config.routes)
			: [];
	if (runContextRoutes.length > 0)
		warnings.push(
			TreeDiagnostics.runContextTarget(location, runContextRoutes)
		);

	const templateTree = rebasedTemplateTree(config, projectDir);
	const template = new RojoProject(
		{ name: config.name, tree: templateTree },
		generatedContainer
	);
	const project = new RojoProject(
		{ name: config.name, tree: templateTree },
		generatedContainer
	);

	const placed = input.files.map(placeEntry);
	const ignored = [
		...input.excluded,
		...input.pruned,
		...input.unrouted,
		...input.skippedLinks,
	].filter((source) => !DECLARATION_FILE.test(source));
	const collapsed = collapsibleDirs(
		placed,
		[...ignored, ...input.superseded],
		(instancePath) => isTemplateContainer(template.getNode(instancePath))
	);

	const insert = (
		instancePath: readonly string[],
		source: string,
		data: Partial<RojoNode>
	) => {
		if (template.getNode(instancePath)) {
			warnings.push(
				TreeDiagnostics.templateClash(
					location,
					instancePath.join(INSTANCE_SEPARATOR),
					source
				)
			);
			return;
		}
		project.insertNode(instancePath, data);
	};

	for (const [dir, instancePath] of collapsed)
		insert(instancePath, dir, { $path: syncPath(dir, layout) });

	for (const entry of placed) {
		if (isCollapsed(entry.source, collapsed)) continue;
		insert(entry.file.instancePath, entry.source, {
			$path: syncPath(entry.source, layout),
		});
	}

	const copied = applyFolderMeta(project, template, config, {
		files: input.files,
		folderMeta: input.folderMeta,
		isReadByRojo: (dir) =>
			collapsed.has(dir) || isCollapsed(dir, collapsed),
	});
	if (copied.isErr()) return copied;
	warnings.push(...copied.value);

	const globIgnorePaths = [
		...new Set([
			...rebasedGlobs(config, projectDir),
			...ignored.map((source) => syncPath(source, layout).optional),
		]),
	];

	const value: RojoTree = {
		...config.template?.project,
		name: config.name,
		tree: project.getTree().tree,
	};
	if (globIgnorePaths.length > 0) value.globIgnorePaths = globIgnorePaths;
	else delete value.globIgnorePaths;

	return ok({ value, warnings });
}

function routesIntoPlayerScripts(
	routes: Readonly<Record<string, string>>
): RunContextRoute[] {
	return Object.entries(routes)
		.filter(([, target]) => {
			const [service, container] = target.split(INSTANCE_SEPARATOR);
			return (
				service === "StarterPlayer" &&
				PLAYER_SCRIPT_CONTAINERS.has(container)
			);
		})
		.map(([key, target]) => ({ key, target }));
}

function placeEntry(file: RoutedFile): PlacedEntry {
	const { entry } = file;
	return {
		file,
		source: toPosix(path.join(entry.rootDir, entry.relativePath)),
		rojoName: rojoNameOf(entry),
	};
}

/** The name Rojo gives the entry when it enumerates the directory itself. */
function rojoNameOf(entry: ScannedEntry): string {
	const name = path.posix.basename(entry.relativePath);
	if (entry.kind === "init-folder") return name;
	const stem = name.slice(0, name.length - path.extname(name).length);
	if (entry.kind === "script") return rojoAssignedName(stem);
	return entry.kind === "data" ? rojoModelName(stem) : stem;
}

/**
 * Directories whose every file on disk is placed under its Rojo name, mapped
 * to the instance path the directory becomes. Only the outermost of nested
 * candidates is kept, and only a directory that names its own node: Rojo would
 * apply a routing, tag or invisible folder's `init.meta.json` to its parent.
 */
function collapsibleDirs(
	placed: readonly PlacedEntry[],
	leftOut: readonly string[],
	isReserved: (instancePath: readonly string[]) => boolean
): Map<string, readonly string[]> {
	const claims = new Map<string, number>();
	const entriesByDir = new Map<string, PlacedEntry[]>();
	const namedDirs = new Set<string>();
	for (const entry of placed) {
		const { instancePath, folderNodes, entry: scanned } = entry.file;
		for (let length = 1; length <= instancePath.length; length++)
			increment(
				claims,
				instancePath.slice(0, length).join(INSTANCE_SEPARATOR)
			);

		const rootDir = toPosix(scanned.rootDir);
		for (const { dir } of folderNodes)
			namedDirs.add(path.posix.join(rootDir, dir));
		for (
			let dir = path.posix.dirname(entry.source);
			isBelow(dir, rootDir);
			dir = path.posix.dirname(dir)
		) {
			const inDir = entriesByDir.get(dir);
			if (inDir) inDir.push(entry);
			else entriesByDir.set(dir, [entry]);
		}
	}

	const blocked = new Set<string>();
	for (const source of leftOut)
		for (
			let dir = path.posix.dirname(source);
			!blocked.has(dir);
			dir = path.posix.dirname(dir)
		) {
			blocked.add(dir);
			if (path.posix.dirname(dir) === dir) break;
		}

	const collapsed = new Map<string, readonly string[]>();
	const outermostFirst = [...entriesByDir.keys()].sort(
		(a, b) => depthOf(a) - depthOf(b)
	);
	for (const dir of outermostFirst) {
		if (
			blocked.has(dir) ||
			!namedDirs.has(dir) ||
			isCollapsed(dir, collapsed)
		)
			continue;
		const entries = entriesByDir.get(dir) as PlacedEntry[];
		const instancePath = instancePathOf(dir, entries);
		if (
			instancePath &&
			!isReserved(instancePath) &&
			claims.get(instancePath.join(INSTANCE_SEPARATOR)) === entries.length
		)
			collapsed.set(dir, instancePath);
	}
	return collapsed;
}

/** The instance the directory becomes, if every entry sits where Rojo would put it. Never a service itself. */
function instancePathOf(
	dir: string,
	entries: readonly PlacedEntry[]
): readonly string[] | undefined {
	let base: readonly string[] | undefined;
	for (const { source, rojoName, file } of entries) {
		const below = path.posix.relative(dir, source).split("/");
		const expected = [...below.slice(0, -1), rojoName];
		const head = file.instancePath.slice(
			0,
			file.instancePath.length - expected.length
		);
		const tail = file.instancePath.slice(head.length);
		if (
			head.length < 2 ||
			tail.some((segment, index) => segment !== expected[index])
		)
			return undefined;
		if (
			base &&
			base.join(INSTANCE_SEPARATOR) !== head.join(INSTANCE_SEPARATOR)
		)
			return undefined;
		base = head;
	}
	return base;
}

/** A template node without a `$path` is a container whose children a collapsed directory would replace. */
function isTemplateContainer(node: RojoNode | undefined): boolean {
	return node !== undefined && node.$path === undefined;
}

function isCollapsed(
	source: string,
	collapsed: ReadonlyMap<string, readonly string[]>
): boolean {
	for (
		let dir = path.posix.dirname(source);
		path.posix.dirname(dir) !== dir;
		dir = path.posix.dirname(dir)
	)
		if (collapsed.has(dir)) return true;
	return false;
}

function isBelow(dir: string, rootDir: string): boolean {
	return dir.startsWith(`${rootDir}/`);
}

function depthOf(dir: string): number {
	return dir.split("/").length;
}

function increment(counts: Map<string, number>, key: string): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

function rebasedTemplateTree(
	config: Pick<ResolvedConfig, "name" | "template">,
	projectDir: string
): RojoNode {
	const { template } = config;
	const tree = template?.project.tree ?? { $className: "DataModel" };
	const rebased = new RojoProject({ tree }, generatedContainer);
	if (template && path.dirname(template.file) !== projectDir) {
		const templateDir = path.dirname(template.file);
		rebased.mapPaths((target) =>
			rebaseTemplatePath(target, templateDir, projectDir)
		);
	}
	return rebased.getTree().tree;
}

/** Studio can't drift from disk inside a folder Rogen owns, so unknown children are removed on sync. */
function generatedContainer(instancePath: readonly string[]): RojoNode {
	const $className = containerClassName(instancePath);
	return $className === "Folder"
		? { $className, $ignoreUnknownInstances: false }
		: { $className };
}

function rebasedGlobs(
	config: Pick<ResolvedConfig, "template">,
	projectDir: string
): string[] {
	const { template } = config;
	const globs = (template?.project.globIgnorePaths ?? []).filter(
		(glob) => typeof glob === "string"
	);
	if (!template || path.dirname(template.file) === projectDir) return globs;
	return globs.map((glob) =>
		relativeToProject(
			path.resolve(path.dirname(template.file), glob),
			projectDir
		)
	);
}
