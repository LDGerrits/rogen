import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoNode } from "../rojo/rojo-tree.js";
import { matchFolderKey, unwrapInvisibleFolder } from "./declared-key.js";
import { MetaDiagnostics, InstancelessFolder } from "./meta-diagnostics.js";
import { FolderMeta } from "./read-folder-meta.js";
import { INIT_META_FILE } from "./root-scanner.js";
import { RojoProject } from "./rojo-project.js";
import { RoutedFile } from "./route-files.js";
import { TreeDiagnostics } from "./tree-diagnostics.js";
import { metaFileFor } from "./unclaimed-meta.js";

const INSTANCE_SEPARATOR = "/";
const FALLBACK_ROUTE = "*";

export interface FolderMetaInput {
	readonly files: readonly RoutedFile[];
	readonly folderMeta: readonly FolderMeta[];
	/** A folder Rojo reads through a `$path`: collapsed, or inside a collapsed folder. */
	readonly isReadByRojo: (dir: string) => boolean;
}

interface ReachedNode {
	readonly instancePath: readonly string[];
	/** The folders that name the node, as absolute POSIX paths. */
	readonly dirs: Set<string>;
}

interface Copy {
	readonly instancePath: readonly string[];
	readonly meta: FolderMeta;
}

/** Copies each folder's meta onto the nodes it names that Rojo wouldn't apply it to; the last root dir wins, and the template beats both. */
export function applyFolderMeta(
	project: RojoProject,
	template: RojoProject,
	config: Pick<ResolvedConfig, "rootDirs" | "routes" | "tags" | "outFile">,
	input: FolderMetaInput
): Result<Diagnostic[], Diagnostic[]> {
	const location = { resource: config.outFile };
	const warnings: Diagnostic[] = [];
	const errors: Diagnostic[] = [];
	const metaByDir = new Map(
		input.folderMeta.map((meta) => [dirOf(meta), meta])
	);
	const sharedWithFile = new Map(
		input.files.map((file) => [
			file.instancePath.join(INSTANCE_SEPARATOR),
			file,
		])
	);

	const copies: Copy[] = [];
	const reportedClashes = new Set<string>();
	for (const [instance, node] of reachedNodes(input.files)) {
		const metas = [...node.dirs]
			.filter((dir) => !input.isReadByRojo(dir))
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
				MetaDiagnostics.sameNode(
					{ resource: clash[0].file },
					instance,
					clash.map(({ file }) => file)
				)
			);
		}

		const shared = sharedWithFile.get(instance);
		if (shared) {
			for (const meta of metas)
				warnings.push(sharedWithScript(meta, shared, instance));
			continue;
		}

		const meta = metas[metas.length - 1];
		const templateNode = template.getNode(node.instancePath);
		if (templateNode?.$path !== undefined) {
			warnings.push(
				TreeDiagnostics.templateClash(location, instance, meta.file)
			);
			continue;
		}
		if (project.getNode(node.instancePath))
			copies.push({ instancePath: node.instancePath, meta });
	}

	for (const [meta, instances] of copiesById(copies))
		if (instances.length > 1)
			errors.push(
				MetaDiagnostics.idOnSeveralNodes(
					{ resource: meta.file },
					meta.id as string,
					instances
				)
			);
	if (errors.length > 0) return err(errors);

	for (const { instancePath, meta } of copies) {
		const templateNode = template.getNode(instancePath) ?? {};
		if (
			templateNode.$className !== undefined &&
			meta.className !== undefined &&
			templateNode.$className !== meta.className
		)
			warnings.push(
				MetaDiagnostics.templateClass(
					location,
					instancePath.join(INSTANCE_SEPARATOR),
					templateNode.$className,
					meta.file,
					meta.className
				)
			);
		project.insertNode(instancePath, fieldsUnder(templateNode, meta));
	}

	const unplaced = metaOnNothing(input.folderMeta, config);
	if (unplaced.length > 0)
		warnings.push(MetaDiagnostics.appliesToNothing(location, unplaced));
	return ok(warnings);
}

function reachedNodes(files: readonly RoutedFile[]): Map<string, ReachedNode> {
	const reached = new Map<string, ReachedNode>();
	for (const { entry, folderNodes } of files) {
		for (const { instancePath, dir } of folderNodes) {
			const key = instancePath.join(INSTANCE_SEPARATOR);
			const node = reached.get(key) ?? { instancePath, dirs: new Set() };
			node.dirs.add(toPosix(path.join(entry.rootDir, dir)));
			reached.set(key, node);
		}
	}
	return reached;
}

/** Each group of metas from one root dir that reach the same node. */
function sameRootClashes(metas: readonly FolderMeta[]): FolderMeta[][] {
	const byRoot = new Map<string, FolderMeta[]>();
	for (const meta of metas)
		byRoot.set(meta.rootDir, [...(byRoot.get(meta.rootDir) ?? []), meta]);
	return [...byRoot.values()]
		.filter((group) => group.length > 1)
		.map((group) => group.sort((a, b) => (a.file < b.file ? -1 : 1)));
}

function copiesById(copies: readonly Copy[]): Map<FolderMeta, string[]> {
	const byMeta = new Map<FolderMeta, string[]>();
	for (const { instancePath, meta } of copies)
		if (meta.id !== undefined)
			byMeta.set(meta, [
				...(byMeta.get(meta) ?? []),
				instancePath.join(INSTANCE_SEPARATOR),
			]);
	return byMeta;
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

function sharedWithScript(
	meta: FolderMeta,
	file: RoutedFile,
	instance: string
): Diagnostic {
	const fileName = path.posix.basename(file.entry.relativePath);
	return MetaDiagnostics.sharedWithScript(
		{ resource: meta.file },
		instance,
		fileName,
		metaFileFor(fileName) ?? `${fileName}/${INIT_META_FILE}`
	);
}

/** Meta in folders that never become an instance, decided by the folder's name. */
function metaOnNothing(
	metas: readonly FolderMeta[],
	config: Pick<ResolvedConfig, "routes" | "tags">
): { readonly file: string; readonly kind: InstancelessFolder }[] {
	const routeKeys = new Set(
		Object.keys(config.routes).filter((key) => key !== FALLBACK_ROUTE)
	);
	const tagKeys = new Set(Object.keys(config.tags));
	return metas.flatMap((meta) => {
		const kind = instancelessFolderOf(meta.dir, routeKeys, tagKeys);
		return kind ? [{ file: toPosix(meta.file), kind }] : [];
	});
}

function instancelessFolderOf(
	dir: string,
	routeKeys: ReadonlySet<string>,
	tagKeys: ReadonlySet<string>
): InstancelessFolder | undefined {
	if (dir === "") return "root dir";
	const { name, invisible } = unwrapInvisibleFolder(path.posix.basename(dir));
	if (matchFolderKey(name, routeKeys)) return "routing folder";
	if (matchFolderKey(name, tagKeys)) return "tag folder";
	return invisible ? "invisible folder" : undefined;
}

function dirOf(meta: FolderMeta): string {
	return toPosix(path.join(meta.rootDir, meta.dir));
}
