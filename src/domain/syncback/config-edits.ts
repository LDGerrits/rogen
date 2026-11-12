import path from "path";
import { toNative, toPosix } from "../../base/path.js";
import { setJsoncValue } from "../../base/jsonc.js";
import { isSameJson } from "../../base/objects.js";
import { tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { featureMetas } from "./feature-metas.js";
import { Operation } from "./mirror-plan.js";
import { MirrorWorkspace } from "./mirror-workspace.js";
import { SyncbackRequest, UnplacedInstance } from "./syncback.js";
import { TreeChange, applyTreeChanges, treeChanges } from "./tree-changes.js";
import { treeWithoutSerializedOverrides } from "./without-serialized-overrides.js";

/** The keys of a node that a meta file holds, by the name it holds them under. */
const META_KEYS: Readonly<Record<string, string>> = {
	$properties: "properties",
	$attributes: "attributes",
};

/** Whether a change to a node is only to what a meta file can hold. */
const isMetaChange = ({ set, remove, added }: TreeChange): boolean =>
	added.length === 0 &&
	[...Object.keys(set), ...remove].every((key) =>
		Object.hasOwn(META_KEYS, key)
	);

/** The meta file of a feature folder, with its text when it is there. */
export interface FeatureMeta {
	readonly file: string;
	readonly text?: string;
}

/** The edits syncback makes to what the project declares rather than syncs: the tree of its config, and the metas of its feature folders. */
export class ConfigEdits {
	private readonly request: SyncbackRequest;

	constructor(
		private readonly workspace: MirrorWorkspace,
		@FileSystemService
		private readonly fileSystemService: FileSystemService
	) {
		this.request = workspace.request;
	}

	/** The meta file of a feature folder that syncback edits: the `.meta.jsonc` when the folder has one, as Rojo applies it last, else the `.meta.json`. */
	async featureMeta(folder: string): Promise<FeatureMeta> {
		for (const name of [RojoFile.INIT_META_JSONC, RojoFile.INIT_META]) {
			const file = toNative(path.posix.join(folder, name));
			if (await this.fileSystemService.isFile(file))
				return {
					file,
					text: await this.fileSystemService.readFile(file),
				};
		}
		return { file: toNative(path.posix.join(folder, RojoFile.INIT_META)) };
	}

	/** The write that sets `keys` in a feature's meta and keeps what else it holds, a key set to `undefined` taken off; `fresh` is the text of a meta that isn't there yet. None when nothing changes, and left out where an ignore glob matches the meta. */
	metaWrite(
		meta: FeatureMeta,
		instance: string,
		keys: Readonly<Record<string, unknown>>,
		fresh?: Uint8Array
	): Operation | UnplacedInstance | undefined {
		if (this.workspace.isIgnored(toPosix(meta.file)))
			return {
				instance,
				reason: `${meta.file} matches an ignore glob of the project, so it is left alone`,
			};
		const kept = Object.entries(keys).filter(
			([, value]) => value !== undefined
		);
		if (meta.text === undefined && kept.length === 0) return undefined;
		let edited = meta.text ?? "{}";
		for (const [key, value] of Object.entries(keys))
			edited = setJsoncValue(edited, [key], value);
		if (edited === meta.text) return undefined;
		return {
			kind: "write",
			file: meta.file,
			instance,
			bytes:
				meta.text === undefined && fresh
					? fresh
					: new TextEncoder().encode(edited),
		};
	}

	/** What Rojo changed in the nodes of the project file it ran on, and the nodes `added` for new instances, as an edit of the config's own tree; a node the tree does not have, which routing made, goes into the meta of the feature folder that makes it, or has no place. */
	async editTree(added: readonly TreeChange[]): Promise<{
		operations: Operation[];
		unplaced: UnplacedInstance[];
	}> {
		const { project } = this.request;
		const { workspace } = this;
		const rewritten = await workspace.rewrittenTree();
		const unread: UnplacedInstance[] =
			rewritten === undefined
				? [
						{
							instance: project.projectName,
							reason: "the project file Rojo rewrote could not be read, so its changes to the nodes of the tree are not written",
						},
					]
				: [];
		const allChanges = [
			...(rewritten === undefined
				? []
				: treeChanges(workspace.mirror.file.tree, rewritten)),
			...added,
		];
		if (allChanges.length === 0)
			return { operations: [], unplaced: unread };
		const editedInStudio =
			rewritten === undefined
				? []
				: treeChanges(
						treeWithoutSerializedOverrides(
							workspace.mirror.file.tree
						),
						treeWithoutSerializedOverrides(rewritten)
					);
		const children = (changes: readonly TreeChange[]) =>
			changes.flatMap(({ node, added: nodes }) =>
				nodes.map(({ name }) => [...node, name])
			);
		const current = await tryWithAsync(() =>
			this.fileSystemService.readFile(project.file)
		);
		const label = (node: readonly string[]) =>
			node.length === 0 ? project.projectName : instanceKey(node);
		if (current.isErr())
			return {
				operations: [],
				unplaced: [
					...unread,
					...[
						...editedInStudio.map(({ node }) => node),
						...children(added),
					].map((node) => ({
						instance: label(node),
						reason: `${project.file} could not be read`,
					})),
				],
			};
		const applied = applyTreeChanges(current.value, ["tree"], allChanges);
		const unhomed = applyTreeChanges(
			current.value,
			["tree"],
			editedInStudio
		).unhomed;
		const routed = editedInStudio.filter(
			(change) =>
				isMetaChange(change) &&
				unhomed.some(
					(node) => instanceKey(node) === instanceKey(change.node)
				)
		);
		const metas =
			project.compiledPath === undefined
				? featureMetas(
						workspace.layout,
						routed.map((change) => ({
							instance: change.node,
							edit: change,
						})),
						(a, b) =>
							isSameJson([a.set, a.remove], [b.set, b.remove])
					)
				: {
						placed: [],
						unplaced: [],
						homeless: routed.map((change) => ({
							instance: change.node,
							edit: change,
						})),
					};
		const operations: Operation[] = [];
		const unplaced: UnplacedInstance[] = [...unread, ...metas.unplaced];
		for (const { folder, instance, edit } of metas.placed) {
			const keys: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(edit.set))
				keys[META_KEYS[key]] = value;
			for (const key of edit.remove) keys[META_KEYS[key]] = undefined;
			const written = this.metaWrite(
				await this.featureMeta(folder),
				instanceKey(instance),
				keys
			);
			if (written === undefined) continue;
			if ("reason" in written) unplaced.push(written);
			else operations.push(written);
		}
		const handled = new Set(
			routed
				.filter(
					(change) =>
						!metas.homeless.some(
							({ instance }) =>
								instanceKey(instance) ===
								instanceKey(change.node)
						)
				)
				.map(({ node }) => instanceKey(node))
		);
		for (const node of unhomed)
			if (!handled.has(instanceKey(node)))
				unplaced.push({
					instance: label(node),
					reason: `a property or attribute changed in Studio, and the tree of ${toNative(project.file)} has no node for it, since routing made it; add a node for it to the tree`,
				});
		if (applied.text !== current.value)
			operations.push({
				kind: "write",
				file: project.file,
				instance: label(allChanges[0].node),
				bytes: new TextEncoder().encode(applied.text),
			});
		return { operations, unplaced };
	}
}
