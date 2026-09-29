import { compareStrings, groupBy } from "../../../../base/collection.js";
import { joinPosix } from "../../../../base/path.js";
import { err, ok } from "../../../../base/result.js";
import { Diagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { RojoProject } from "../../../rojo/rojo-project.js";
import { RojoNode, instanceKey } from "../../../rojo/rojo-tree.js";
import {
	AssemblyStage,
	FolderMeta,
	FolderMetaOutcome,
	RoutedFile,
} from "../../build-record.js";
import { MetaDiagnostics } from "../../meta-diagnostics.js";
import { generatedContainer } from "../../layout/template.js";
import { isCollapsed } from "./assemble-tree.js";

interface ReachedNode {
	readonly instancePath: readonly string[];
	/** The folders that name the node, as absolute POSIX paths. */
	readonly dirs: Set<string>;
}

type Copy = Extract<FolderMetaOutcome, { kind: "copied" }>;

/** Copies each folder's meta onto the nodes it names that Rojo wouldn't apply it to; the last root dir wins, and the template beats both. */
export const applyFolderMeta: AssemblyStage = (build) => {
	const { config, template, collapsed } = build;
	const project = new RojoProject(build.tree, generatedContainer);
	const errors: Diagnostic[] = [];
	const metaByDir = new Map(
		build.folderMeta.map((meta) => [dirOf(meta), meta])
	);
	const sharedWithFile = new Map(
		build.files.map((file) => [instanceKey(file.instancePath), file])
	);
	const isReadByRojo = (dir: string) =>
		collapsed.has(dir) || isCollapsed(dir, collapsed);

	const outcomes: FolderMetaOutcome[] = [];
	const reportedClashes = new Set<string>();
	const displaced = build.routed.filter(
		(file) => build.leftOut.get(file.entry.source)?.status === "displaced"
	);
	for (const [instance, node] of reachedNodes([
		...build.files,
		...displaced,
	])) {
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
				MetaDiagnostics.sameNode(
					{ resource: clash[0].file },
					instance,
					clash.map(({ file }) => file)
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
				MetaDiagnostics.idOnSeveralNodes(
					{ resource: meta.file },
					meta.id as string,
					instances
				)
			);
	if (errors.length > 0) return err(errors);

	for (const { instancePath, meta, templateNode } of copies)
		project.insertNode(instancePath, fieldsUnder(templateNode, meta));
	return ok({ ...build, tree: project.getTree(), metaOutcomes: outcomes });
};

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
