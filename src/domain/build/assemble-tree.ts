import path from "path";
import { isObject } from "../../base/object.js";
import { toPosix } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { rojoAssignedName } from "../rojo/rojo-assigned-name.js";
import { RojoNode, RojoPath, RojoTree } from "../rojo/rojo-tree.js";
import { ScannedEntry } from "./root-scanner.js";
import { RojoProject } from "./rojo-project.js";
import { RoutedFile } from "./route-files.js";
import {
	SyncLayout,
	commonRoot,
	rebaseTemplatePath,
	relativeToProject,
	syncPath,
} from "./sync-path.js";
import { TreeDiagnostics } from "./tree-diagnostics.js";

export interface AssemblyInput {
	readonly files: readonly RoutedFile[];
	/** Absolute POSIX source paths Rogen deliberately left out, by reason. */
	readonly excluded: readonly string[];
	readonly pruned: readonly string[];
	readonly unrouted: readonly string[];
	/** Files that lost their instance path to another; they block a collapse but aren't ignored. */
	readonly superseded: readonly string[];
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

/** Merges the routed files into the template, collapsing a directory into one `$path` where Rojo would see the same files. */
export function assembleTree(
	config: Pick<
		ResolvedConfig,
		"name" | "rootDirs" | "template" | "syncDir" | "outFile"
	>,
	input: AssemblyInput
): AssemblyOutput {
	const location = { resource: config.outFile };
	const projectDir = path.dirname(config.outFile);
	const layout: SyncLayout = {
		commonRoot: commonRoot(config.rootDirs),
		syncDir: config.syncDir,
		projectDir,
	};
	const warnings: Diagnostic[] = [];

	const templateTree = rebasedTemplateTree(config, projectDir);
	const template = new RojoProject({ name: config.name, tree: templateTree });
	const project = new RojoProject({ name: config.name, tree: templateTree });

	const placed = input.files.map(placeEntry);
	const ignored = [
		...input.excluded,
		...input.pruned,
		...input.unrouted,
	].filter((source) => !DECLARATION_FILE.test(source));
	const collapsed = collapsibleDirs(placed, [
		...ignored,
		...input.superseded,
	]);

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

	const standaloneData: string[] = [];
	for (const entry of placed) {
		if (isCollapsed(entry.source, collapsed)) continue;
		if (entry.file.entry.kind === "data") {
			standaloneData.push(entry.source);
			continue;
		}
		insert(entry.file.instancePath, entry.source, {
			$path: syncPath(entry.source, layout),
		});
	}
	if (standaloneData.length > 0)
		warnings.push(TreeDiagnostics.standaloneData(location, standaloneData));

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

	return { value, warnings };
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
	return entry.kind === "script" ? rojoAssignedName(stem) : stem;
}

/**
 * Directories whose every file on disk is placed under its Rojo name, mapped
 * to the instance path the directory becomes. Only the outermost of nested
 * candidates is kept.
 */
function collapsibleDirs(
	placed: readonly PlacedEntry[],
	leftOut: readonly string[]
): Map<string, readonly string[]> {
	const claims = new Map<string, number>();
	const entriesByDir = new Map<string, PlacedEntry[]>();
	for (const entry of placed) {
		const { instancePath, entry: scanned } = entry.file;
		for (let length = 1; length <= instancePath.length; length++)
			increment(
				claims,
				instancePath.slice(0, length).join(INSTANCE_SEPARATOR)
			);

		const rootDir = toPosix(scanned.rootDir);
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
		if (blocked.has(dir) || isCollapsed(dir, collapsed)) continue;
		const entries = entriesByDir.get(dir) as PlacedEntry[];
		const instancePath = instancePathOf(dir, entries);
		if (
			instancePath &&
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
	config: Pick<ResolvedConfig, "template">,
	projectDir: string
): RojoNode {
	const { template } = config;
	const tree = template?.project.tree ?? { $className: "DataModel" };
	if (!template || path.dirname(template.file) === projectDir)
		return structuredClone(tree);
	return rebaseNode(tree, path.dirname(template.file), projectDir);
}

function rebaseNode(
	node: RojoNode,
	templateDir: string,
	projectDir: string
): RojoNode {
	const rebased: RojoNode = {};
	for (const [key, value] of Object.entries(node)) {
		if (key === "$path" && isRojoPath(value))
			rebased.$path = rebaseTemplatePath(value, templateDir, projectDir);
		else if (!key.startsWith("$") && isObject(value))
			rebased[key] = rebaseNode(value, templateDir, projectDir);
		else rebased[key] = structuredClone(value);
	}
	return rebased;
}

function isRojoPath(value: unknown): value is RojoPath {
	return (
		typeof value === "string" ||
		(isObject(value) && typeof value.optional === "string")
	);
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
