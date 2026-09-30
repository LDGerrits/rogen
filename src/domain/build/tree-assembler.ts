import path from "path";
import { compareStrings, groupBy } from "../../base/collection.js";
import { ErrorUtils } from "../../base/errors.js";
import { JsoncNode, parseJsonc } from "../../base/jsonc.js";
import { ancestors, isInside, joinPosix, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo-file.js";
import {
	RojoNode,
	RojoProject,
	RojoTree,
	instanceKey,
} from "../rojo/rojo-project.js";
import {
	AssembledBuild,
	FolderMeta,
	FolderMetaFields,
	FolderMetaOutcome,
	PlacedBuild,
	RoutedFile,
	ScannedEntry,
	ScannedRoot,
} from "./build-record.js";
import { isReadOnly, syncPath } from "./sync-layout.js";
import { generatedContainer, templateGlobs } from "./template.js";

interface TreeAssembly {
	readonly tree: RojoTree;
	/** Directories written as one `$path`, mapped to the instance each becomes. */
	readonly collapsed: ReadonlyMap<string, readonly string[]>;
}

interface FolderMetaApplication {
	readonly tree: RojoTree;
	readonly metaOutcomes: readonly FolderMetaOutcome[];
}

const FIELD_KINDS: Record<keyof FolderMetaFields, JsoncNode["kind"]> = {
	className: "string",
	properties: "object",
	attributes: "object",
	ignoreUnknownInstances: "boolean",
	id: "string",
};

const KIND_NAMES: Record<JsoncNode["kind"], string> = {
	object: "an object",
	array: "an array",
	string: "a string",
	number: "a number",
	boolean: "a boolean",
	null: "null",
};

/** Turns a placed build into its Rojo tree; the only reads it makes are the folder meta files. */
export class TreeAssembler {
	constructor(private readonly fileSystemService: FileSystemService) {}

	async assemble(
		placed: PlacedBuild
	): Promise<Result<AssembledBuild, Diagnostic[]>> {
		const folderMeta = await this.readFolderMeta(placed.roots);
		if (folderMeta.isErr()) return err(folderMeta.error);

		const assembly = assembleTree(placed);
		const applied = applyFolderMeta(placed, folderMeta.value, assembly);
		if (applied.isErr()) return err(applied.error);

		return ok({
			...placed,
			folderMeta: folderMeta.value,
			collapsed: assembly.collapsed,
			tree: applied.value.tree,
			metaOutcomes: applied.value.metaOutcomes,
		});
	}

	/** Reads every `init.meta.json` the scan found, which leaves out excluded folders; any invalid one fails the whole read. */
	private async readFolderMeta(
		roots: readonly ScannedRoot[]
	): Promise<Result<FolderMeta[], Diagnostic[]>> {
		const metas: FolderMeta[] = [];
		const errors: Diagnostic[] = [];

		for (const root of roots) {
			for (const metaFile of root.metaFiles) {
				if (path.posix.basename(metaFile) !== RojoFile.INIT_META)
					continue;
				const file = path.join(root.rootDir, metaFile);
				const parsed = await this.readMetaFile(file);
				if (parsed.isErr()) {
					errors.push(...parsed.error);
					continue;
				}
				const dir = path.posix.dirname(toPosix(metaFile));
				metas.push({
					file,
					rootDir: root.rootDir,
					dir: dir === "." ? "" : dir,
					...parsed.value,
				});
			}
		}

		return errors.length > 0 ? err(errors) : ok(metas);
	}

	private async readMetaFile(
		file: string
	): Promise<Result<FolderMetaFields, Diagnostic[]>> {
		let text: string;
		try {
			text = await this.fileSystemService.readFile(file);
		} catch (error) {
			return err([
				errorDiagnostic(
					"meta.unreadable",
					{ resource: file },
					`the meta file could not be read: ${ErrorUtils.fromUnknown(error).message}.`
				),
			]);
		}
		return parseFolderMeta(file, text);
	}
}

/** Merges the placed files into the template, collapsing a directory into one `$path` where Rojo would see the same files. */
function assembleTree({
	config,
	layout,
	template,
	files,
	leftOut: allLeftOut,
}: Pick<
	PlacedBuild,
	"config" | "layout" | "template" | "files" | "leftOut"
>): TreeAssembly {
	const project = new RojoProject(template.getTree(), generatedContainer);
	const leftOut = [...allLeftOut].filter(
		([source]) => !isReadOnly(source, layout)
	);
	// A replaced file may share the winner's emitted path, and the template may mount a displaced one.
	const ignored = leftOut
		.filter(
			([, why]) => why.status !== "replaced" && why.status !== "displaced"
		)
		.map(([source]) => source)
		.sort(compareStrings);
	const collapsed = collapsibleDirs(
		files,
		leftOut.map(([source]) => source),
		(instancePath) => template.getNode(instancePath) !== undefined
	);

	for (const [dir, instancePath] of collapsed)
		project.insertNode(instancePath, { $path: syncPath(dir, layout) });
	for (const { entry, instancePath } of files) {
		if (isCollapsed(entry.source, collapsed)) continue;
		project.insertNode(instancePath, {
			$path: syncPath(entry.source, layout),
		});
	}

	const globIgnorePaths = [
		...new Set([
			...templateGlobs(config, layout.projectDir),
			...ignored.map((source) => syncPath(source, layout).optional),
		]),
	];
	const tree: RojoTree = {
		...config.template?.project,
		name: config.name,
		tree: project.getTree().tree,
	};
	if (globIgnorePaths.length > 0) tree.globIgnorePaths = globIgnorePaths;
	else delete tree.globIgnorePaths;
	return { tree, collapsed };
}

interface PlacedEntry {
	readonly file: RoutedFile;
	readonly source: string;
	readonly rojoName: string;
}

function placeEntry(file: RoutedFile): PlacedEntry {
	const { entry } = file;
	return {
		file,
		source: entry.source,
		rojoName: rojoNameOf(entry),
	};
}

/** The name Rojo gives the entry when it enumerates the directory itself. */
function rojoNameOf(entry: ScannedEntry): string {
	const name = path.posix.basename(entry.relativePath);
	return entry.kind === "init-folder"
		? name
		: new RojoFile(name).instanceName;
}

/**
 * Directories whose every file on disk is placed under its Rojo name, mapped
 * to the instance path the directory becomes. Only the outermost of nested
 * candidates is kept, and only a directory that names its own node: Rojo would
 * apply a routing, tag or invisible folder's `init.meta.json` to its parent.
 */
function collapsibleDirs(
	files: readonly RoutedFile[],
	leftOut: readonly string[],
	isReserved: (instancePath: readonly string[]) => boolean
): Map<string, readonly string[]> {
	const placed = files.map(placeEntry);
	const claims = new Map<string, number>();
	const entriesByDir = new Map<string, PlacedEntry[]>();
	const namedDirs = new Set<string>();
	for (const entry of placed) {
		const { instancePath, folderNodes, entry: scanned } = entry.file;
		for (let length = 1; length <= instancePath.length; length++)
			increment(claims, instanceKey(instancePath.slice(0, length)));

		const rootDir = toPosix(scanned.rootDir);
		for (const { dir } of folderNodes)
			namedDirs.add(path.posix.join(rootDir, dir));
		for (const dir of ancestors(entry.source)) {
			if (!isInside(dir, rootDir)) break;
			const inDir = entriesByDir.get(dir);
			if (inDir) inDir.push(entry);
			else entriesByDir.set(dir, [entry]);
		}
	}

	const blocked = new Set<string>();
	for (const source of leftOut)
		for (const dir of ancestors(source)) {
			if (blocked.has(dir)) break;
			blocked.add(dir);
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
			claims.get(instanceKey(instancePath)) === entries.length
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
		if (base && instanceKey(base) !== instanceKey(head)) return undefined;
		base = head;
	}
	return base;
}

function isCollapsed(
	source: string,
	collapsed: ReadonlyMap<string, readonly string[]>
): boolean {
	for (const dir of ancestors(source)) if (collapsed.has(dir)) return true;
	return false;
}

function depthOf(dir: string): number {
	return dir.split("/").length;
}

function increment(counts: Map<string, number>, key: string): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

interface ReachedNode {
	readonly instancePath: readonly string[];
	/** The folders that name the node, as absolute POSIX paths. */
	readonly dirs: Set<string>;
}

type Copy = Extract<FolderMetaOutcome, { kind: "copied" }>;

/** Copies each folder's meta onto the nodes it names that Rojo wouldn't apply it to; the last root dir wins, and the template beats both. */
function applyFolderMeta(
	{
		config,
		template,
		files,
		routed,
		leftOut,
	}: Pick<
		PlacedBuild,
		"config" | "template" | "files" | "routed" | "leftOut"
	>,
	folderMeta: readonly FolderMeta[],
	{ tree, collapsed }: TreeAssembly
): Result<FolderMetaApplication, Diagnostic[]> {
	const project = new RojoProject(tree, generatedContainer);
	const errors: Diagnostic[] = [];
	const metaByDir = new Map(folderMeta.map((meta) => [dirOf(meta), meta]));
	const sharedWithFile = new Map(
		files.map((file) => [instanceKey(file.instancePath), file])
	);
	const isReadByRojo = (dir: string) =>
		collapsed.has(dir) || isCollapsed(dir, collapsed);

	const outcomes: FolderMetaOutcome[] = [];
	const reportedClashes = new Set<string>();
	const displaced = routed.filter(
		(file) => leftOut.get(file.entry.source)?.status === "displaced"
	);
	for (const [instance, node] of reachedNodes([...files, ...displaced])) {
		const metas = [...node.dirs]
			.filter((dir) => !isReadByRojo(dir))
			.flatMap((dir) => metaByDir.get(dir) ?? [])
			.sort(
				(a, b) =>
					config.rootDirs.indexOf(a.rootDir) -
					config.rootDirs.indexOf(b.rootDir)
			);
		if (metas.length === 0) continue;

		for (const clash of sameRootClashes(metas)) {
			const key = clash.map(({ file }) => file).join("\0");
			if (reportedClashes.has(key)) continue;
			reportedClashes.add(key);
			errors.push(
				errorDiagnostic(
					"meta.sameNode",
					{ resource: clash[0].file },
					`${clash.map(({ file }) => file).join(" and ")} both apply to "${instance}" from one root dir, and neither ranks above the other. Keep one of them.`
				)
			);
		}

		const shared = sharedWithFile.get(instance);
		if (shared) {
			outcomes.push({ kind: "shared", instance, metas, file: shared });
			continue;
		}

		const meta = metas[metas.length - 1];
		const templateNode = template.getNode(node.instancePath);
		if (templateNode?.$path !== undefined)
			outcomes.push({ kind: "templatePath", instance, meta });
		else if (project.getNode(node.instancePath))
			outcomes.push({
				kind: "copied",
				instancePath: node.instancePath,
				meta,
				templateNode: templateNode ?? {},
			});
	}

	const copies = outcomes.filter(
		(outcome): outcome is Copy => outcome.kind === "copied"
	);
	for (const [meta, instances] of copiesById(copies))
		if (instances.length > 1)
			errors.push(
				errorDiagnostic(
					"meta.idOnSeveralNodes",
					{ resource: meta.file },
					`id "${meta.id}" would be copied onto ${instances.length} instances (${instances.join(", ")}), but a ref must be unique. Remove the id, or keep the folder's files in one service.`
				)
			);
	if (errors.length > 0) return err(errors);

	for (const { instancePath, meta, templateNode } of copies)
		project.insertNode(instancePath, fieldsUnder(templateNode, meta));
	return ok({ tree: project.getTree(), metaOutcomes: outcomes });
}

function reachedNodes(files: readonly RoutedFile[]): Map<string, ReachedNode> {
	const reached = new Map<string, ReachedNode>();
	for (const { entry, folderNodes } of files) {
		for (const { instancePath, dir } of folderNodes) {
			const key = instanceKey(instancePath);
			const node = reached.get(key) ?? { instancePath, dirs: new Set() };
			node.dirs.add(joinPosix(entry.rootDir, dir));
			reached.set(key, node);
		}
	}
	return reached;
}

/** Each group of metas from one root dir that reach the same node. */
function sameRootClashes(metas: readonly FolderMeta[]): FolderMeta[][] {
	return [...groupBy(metas, ({ rootDir }) => rootDir).values()]
		.filter((group) => group.length > 1)
		.map((group) => group.sort((a, b) => compareStrings(a.file, b.file)));
}

function copiesById(copies: readonly Copy[]): Map<FolderMeta, string[]> {
	return groupBy(
		copies.filter(
			({ meta, templateNode }) =>
				meta.id !== undefined && templateNode.$id === undefined
		),
		({ meta }) => meta,
		({ instancePath }) => instanceKey(instancePath)
	);
}

/** Mirrors Rojo's precedence of a project's fields over a folder's meta. */
function fieldsUnder(
	templateNode: RojoNode,
	meta: FolderMeta
): Partial<RojoNode> {
	const fields: Partial<RojoNode> = {};
	if (meta.className !== undefined && templateNode.$className === undefined)
		fields.$className = meta.className;
	if (meta.properties !== undefined)
		fields.$properties = {
			...meta.properties,
			...templateNode.$properties,
		};
	if (meta.attributes !== undefined && templateNode.$attributes === undefined)
		fields.$attributes = { ...meta.attributes };
	if (
		meta.ignoreUnknownInstances !== undefined &&
		templateNode.$ignoreUnknownInstances === undefined
	)
		fields.$ignoreUnknownInstances = meta.ignoreUnknownInstances;
	if (meta.id !== undefined && templateNode.$id === undefined)
		fields.$id = meta.id;
	return fields;
}

function dirOf(meta: FolderMeta): string {
	return joinPosix(meta.rootDir, meta.dir);
}

function parseFolderMeta(
	file: string,
	text: string
): Result<FolderMetaFields, Diagnostic[]> {
	const { root, value, errors } = parseJsonc(text);
	if (errors.length > 0)
		return err(
			errors.map(({ message, line, column }) =>
				errorDiagnostic(
					"meta.invalidSyntax",
					{ resource: file, position: { line, column } },
					`invalid JSONC: ${message}.`
				)
			)
		);
	if (root?.kind !== "object")
		return err([
			errorDiagnostic(
				"meta.notAnObject",
				{ resource: file, position: { line: 1, column: 1 } },
				"a meta file must be a JSON object."
			),
		]);

	// Rojo ignores fields it doesn't know, such as `$schema`.
	const wrongTypes = root.properties.flatMap((property) => {
		if (!Object.hasOwn(FIELD_KINDS, property.name)) return [];
		const expected = FIELD_KINDS[property.name as keyof FolderMetaFields];
		if (property.value.kind === expected) return [];
		return [
			errorDiagnostic(
				"meta.wrongType",
				{
					resource: file,
					position: {
						line: property.value.line,
						column: property.value.column,
					},
				},
				`"${property.name}": expected ${KIND_NAMES[expected]}, found ${KIND_NAMES[property.value.kind]}.`
			),
		];
	});
	if (wrongTypes.length > 0) return err(wrongTypes);

	const fields = value as Record<string, unknown>;
	return ok(
		Object.fromEntries(
			Object.keys(FIELD_KINDS)
				.filter((key) => fields[key] !== undefined)
				.map((key) => [key, fields[key]])
		) as FolderMetaFields
	);
}
