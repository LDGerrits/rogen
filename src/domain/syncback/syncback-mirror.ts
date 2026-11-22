import { isSameJson } from "../../base/objects.js";
import path from "path";
import { isGlobsetMatch } from "../../base/glob.js";
import { commonFolderPosix, containsPosix, toPosix } from "../../base/path.js";
import { containerClassName } from "../roblox/roblox.js";
import { PlacedLocation } from "../write/write-service.js";
import { RojoFile } from "../rojo/rojo.js";
import {
	RojoNode,
	RojoProject,
	RojoProjectFile,
	NODE_FIELDS,
	childNodes,
	isChildNode,
	isProjectFileName,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { SyncRule } from "../rojo/sync-rules.js";
import { SyncbackLayout } from "./syncback-layout.js";

const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/;

/**
 * The sync rule Rojo's syncback stops on: it can't write a script it reads as a
 * legacy LocalScript.
 */
const UNSYNCABLE_USE = "legacyClientScript";

/**
 * Rojo's syncback drops the property that holds these classes' contents
 * (`Value`, `Source`, `Contents`) from a node that has a `$path`.
 */
const PATH_DROPS_CONTENT: ReadonlySet<string | undefined> = new Set([
	"StringValue",
	"Script",
	"LocalScript",
	"ModuleScript",
	"LocalizationTable",
]);

/**
 * The services Studio fills with instances of its own, such as Workspace's
 * Camera and Terrain, which a route to them must not take for new features.
 */
const STUDIO_FILLED: ReadonlySet<string> = new Set([
	"Workspace",
	"Lighting",
	"SoundService",
	"TextChatService",
	"Chat",
	"MaterialService",
	"Players",
	"Teams",
]);

const isPlainFolder = (node: RojoNode): boolean =>
	node.$className === "Folder" &&
	Object.entries(node).every(
		([key, value]) =>
			isChildNode(key, value) ||
			key === "$className" ||
			key === "$ignoreUnknownInstances"
	);

interface MirrorEntry {
	readonly mirror: string;
	readonly target: string;
	readonly kind: "file" | "folder";
}

interface NodeFolder {
	readonly mirror: string;
	readonly node: readonly string[];
}

interface SyncbackMirrorInputs {
	readonly written: RojoProjectFile;
	readonly tree: RojoNode;
	readonly routeTargets: readonly (readonly string[])[];
	readonly dir: string;
	readonly root: string;
	readonly placed: readonly PlacedLocation[];
	readonly reads: readonly string[];
	readonly fileAt: (target: string) => RojoFile;
	readonly isFolder: (target: string) => Promise<boolean>;
	readonly readText: (target: string) => Promise<string | undefined>;
}

export class SyncbackMirror {
	private constructor(
		readonly file: RojoProjectFile,
		readonly entries: readonly MirrorEntry[],
		readonly folders: readonly string[],
		readonly nodeFolders: readonly NodeFolder[],
		private readonly kept: ReadonlyMap<string, readonly string[]>,
		private readonly rules: readonly SyncRule[],
		private readonly added: Map<RojoNode, readonly string[]>
	) {}

	static async of(inputs: SyncbackMirrorInputs): Promise<SyncbackMirror> {
		const file = structuredClone(inputs.written);
		const rules = (file.syncRules ?? []).filter(
			(rule) => rule.use !== UNSYNCABLE_USE
		);
		delete file.syncRules;
		const added =
			file.tree.$path === undefined
				? SyncbackMirror.addRouteTargets(file.tree, inputs.routeTargets)
				: new Map<RojoNode, readonly string[]>();
		const walk = new MirrorWalk(inputs, added);
		if (file.tree.$path === undefined)
			await walk.children(file.tree, [], "");
		else await walk.keep(file.tree, [], undefined);
		SyncbackMirror.assertInside(file, inputs.root);
		return new SyncbackMirror(
			file,
			walk.entries,
			walk.folders,
			walk.nodeFolders,
			walk.keptNodes,
			rules,
			added
		);
	}

	private static addRouteTargets(
		tree: RojoNode,
		routeTargets: readonly (readonly string[])[]
	): Map<RojoNode, readonly string[]> {
		const added = new Map<RojoNode, readonly string[]>();
		for (const target of routeTargets) {
			if (STUDIO_FILLED.has(target[0])) continue;
			let node = tree;
			for (let depth = 1; depth <= target.length; depth++) {
				if (
					node.$path !== undefined ||
					node.$ignoreUnknownInstances === true
				)
					break;
				const name = target[depth - 1];
				const child = childNodes(node).find(([key]) => key === name);
				if (child) {
					node = child[1];
					continue;
				}
				const instancePath = target.slice(0, depth);
				const made: RojoNode = {
					$className: containerClassName(instancePath),
				};
				node[name] = made;
				added.set(made, instancePath);
				node = made;
			}
		}
		return added;
	}

	static assertInside(file: RojoProjectFile, root: string): void {
		const check = (node: RojoNode): void => {
			if (node.$path !== undefined) {
				const target = rojoPathTarget(node.$path);
				if (!containsPosix(root, target))
					throw new Error(
						`syncback's project reads "${target}", outside its mirror ${root}.`
					);
			}
			for (const [, child] of childNodes(node)) check(child);
		};
		check(file.tree);
	}

	dropAdded(parent: string, child: string): boolean {
		for (const instancePath of this.added.values()) {
			const at = instancePath.length;
			if (
				instancePath[at - 1] !== child ||
				(at > 1 && instancePath[at - 2] !== parent)
			)
				continue;
			let holder = this.file.tree;
			for (const name of instancePath.slice(0, -1))
				holder = holder[name] as RojoNode;
			delete holder[child];
			for (const [other, below] of this.added)
				if (isSameJson(below.slice(0, at), instancePath))
					this.added.delete(other);
			return true;
		}
		return false;
	}

	rulesFor(
		files: readonly { readonly mirror: string; readonly target: string }[],
		root: string,
		dir: string
	): SyncRule[] {
		const base = toPosix(dir);
		const rules: SyncRule[] = [];
		for (const rule of this.rules) {
			for (const { mirror, target } of files) {
				const relative = path.posix.relative(base, target);
				if (!isGlobsetMatch(relative, rule.pattern)) continue;
				if (rule.exclude && isGlobsetMatch(relative, rule.exclude))
					continue;
				rules.push({
					pattern: path.posix.join(root, mirror),
					use: rule.use,
					...(rule.suffix !== undefined && { suffix: rule.suffix }),
				});
			}
		}
		return rules;
	}

	instancePathOf(mirror: string): string[] {
		const names = mirror.split("/");
		for (let depth = names.length; depth > 0; depth--) {
			const node = this.kept.get(names.slice(0, depth).join("/"));
			if (node) return [...node, ...names.slice(depth)];
		}
		return names;
	}

	targetOf(mirror: string): string | undefined {
		const exact = this.entries.find((entry) => entry.mirror === mirror);
		if (exact) return exact.target;
		const folder = this.entries
			.filter(
				(entry) =>
					entry.kind === "folder" &&
					mirror.startsWith(`${entry.mirror}/`)
			)
			.sort((a, b) => b.mirror.length - a.mirror.length)[0];
		return folder
			? path.posix.join(
					folder.target,
					mirror.slice(folder.mirror.length + 1)
				)
			: undefined;
	}

	get clashes(): string[][] {
		const byPath = new Map<string, MirrorEntry[]>();
		for (const entry of this.entries) {
			const key = entry.mirror.toLowerCase();
			byPath.set(key, [...(byPath.get(key) ?? []), entry]);
		}
		return [...byPath.values()]
			.filter((entries) => entries.length > 1)
			.map((entries) => entries.map(({ target }) => target));
	}
}

const KEPT = "~kept";

type Placement =
	| { readonly kind: "moved"; readonly target: string }
	| { readonly kind: "nested" }
	| { readonly kind: "kept" };

const KEPT_NODE: Placement = { kind: "kept" };

class MirrorWalk {
	readonly entries: MirrorEntry[] = [];
	readonly folders: string[] = [];
	readonly nodeFolders: NodeFolder[] = [];
	readonly keptNodes = new Map<string, readonly string[]>();
	private kept = 0;

	private readonly made = new Set<string>();

	constructor(
		private readonly inputs: SyncbackMirrorInputs,
		private readonly added: ReadonlyMap<RojoNode, readonly string[]>
	) {
		for (const { instancePath } of inputs.placed)
			for (let depth = 1; depth <= instancePath.length; depth++)
				this.made.add(instancePath.slice(0, depth).join("\0"));
	}

	private addFolder(folder: string): void {
		this.folders.push(folder);
	}

	async children(
		node: RojoNode,
		instancePath: readonly string[],
		folder: string | undefined,
		mounted = false
	): Promise<boolean> {
		let moved = false;
		const children = childNodes(node).map(
			([name, child]) =>
				[
					name,
					child,
					folder === undefined
						? KEPT_NODE
						: this.classify(name, child, instancePath),
				] as const
		);
		const mounts =
			folder !== undefined &&
			(mounted ||
				children.some(([, , placement]) => placement.kind !== "kept"));
		for (const [name, child, placement] of children) {
			const here = [...instancePath, name];
			const at =
				folder !== undefined && SAFE_NAME.test(name)
					? folder === ""
						? name
						: `${folder}/${name}`
					: undefined;
			if (at === undefined || folder === undefined) {
				await this.keep(child, here, undefined);
				continue;
			}
			switch (placement.kind) {
				case "moved":
					await this.add(placement.target, at, name, folder);
					break;
				case "nested":
					await this.children(child, here, at);
					this.addFolder(at);
					break;
				case "kept":
					if (await this.dissolves(child, here)) {
						await this.keep(child, here, at);
						break;
					}
					await this.keep(child, here, mounts ? undefined : at);
					continue;
			}
			delete node[name];
			moved = true;
		}
		return moved;
	}

	private classify(
		name: string,
		child: RojoNode,
		instancePath: readonly string[]
	): Placement {
		if (!SAFE_NAME.test(name) || this.added.has(child)) return KEPT_NODE;
		const here = [...instancePath, name];
		const target = this.madeFrom(child, here);
		if (target !== undefined)
			return this.readsAlike(target, name) && !this.isInitFile(target)
				? { kind: "moved", target }
				: KEPT_NODE;
		return instancePath.length > 0 && this.madeWhole(child, here)
			? { kind: "nested" }
			: KEPT_NODE;
	}

	private readsAlike(target: string, name: string): boolean {
		const now = this.inputs.fileAt(target);
		const renamed = this.inputs.fileAt(
			path.posix.join(
				path.posix.dirname(target),
				`${name}${this.suffixOf(target)}`
			)
		);
		return (
			renamed.instanceName === name &&
			renamed.kind === now.kind &&
			renamed.isProject === now.isProject &&
			renamed.isMeta === now.isMeta &&
			renamed.scriptSuffix === now.scriptSuffix
		);
	}

	private suffixOf(target: string): string {
		return path.posix
			.basename(target)
			.slice(this.inputs.fileAt(target).instanceName.length);
	}

	private async dissolves(
		node: RojoNode,
		instancePath: readonly string[]
	): Promise<boolean> {
		if (node.$path === undefined || this.inOwnTree(instancePath))
			return false;
		if (
			Object.keys(node).some(
				(key) =>
					NODE_FIELDS.has(key) &&
					key !== "$path" &&
					key !== "$ignoreUnknownInstances"
			)
		)
			return false;
		if (!this.made.has(instancePath.join("\0"))) return false;
		const target = toPosix(
			path.resolve(this.inputs.dir, rojoPathTarget(node.$path))
		);
		if (
			!this.isInitFile(target) &&
			!(
				this.inputs.reads.some((read) => containsPosix(read, target)) &&
				(await this.inputs.isFolder(target))
			)
		)
			return false;
		return childNodes(node).every(
			([name, child]) =>
				this.classify(name, child, instancePath).kind !== "kept"
		);
	}

	private inOwnTree(instancePath: readonly string[]): boolean {
		let own: RojoNode | undefined = this.inputs.tree;
		for (const name of instancePath) {
			const child: unknown = own && Object.hasOwn(own, name) && own[name];
			own = isChildNode(name, child) ? child : undefined;
		}
		return own !== undefined;
	}

	private madeWhole(
		node: RojoNode,
		instancePath: readonly string[]
	): boolean {
		return (
			isPlainFolder(node) &&
			childNodes(node).every(
				([name, child]) =>
					this.classify(name, child, instancePath).kind !== "kept"
			)
		);
	}

	async keep(
		node: RojoNode,
		instancePath: readonly string[],
		at: string | undefined
	): Promise<void> {
		if (node.$path === undefined) {
			const own = at ?? this.spare();
			if (await this.children(node, instancePath, own))
				this.mount(node, own, instancePath);
			else if (this.takesChildren(node, instancePath)) {
				const empty = this.spare();
				this.mount(node, empty, instancePath);
				this.nodeFolders.push({ mirror: empty, node: instancePath });
			} else if (this.isRouteTarget(node, instancePath))
				this.mount(node, this.spare(), instancePath);
			return;
		}
		const target = toPosix(
			path.resolve(this.inputs.dir, rojoPathTarget(node.$path))
		);
		const optional = typeof node.$path !== "string";
		if (await this.inputs.isFolder(target)) {
			const own = at ?? this.spare();
			this.keptNodes.set(own, instancePath);
			this.entries.push({ mirror: own, target, kind: "folder" });
			this.repoint(node, own, optional);
			await this.children(node, instancePath, own, true);
			return;
		}
		if (isProjectFileName(target)) {
			await this.keepProject(node, instancePath, target, optional);
			return;
		}
		if (this.isInitFile(target)) {
			await this.keepInit(node, instancePath, target, optional, at);
			return;
		}
		const own = this.spare();
		const base = path.posix.basename(target);
		const rojoName = this.inputs.fileAt(target).instanceName;
		const meta = `${own}/${rojoName}${RojoFile.META_SUFFIX}`;
		this.keptNodes.set(`${own}/${base}`, instancePath);
		this.keptNodes.set(meta, instancePath);
		this.entries.push(
			{ mirror: `${own}/${base}`, target, kind: "file" },
			{
				mirror: meta,
				target: path.posix.join(
					path.posix.dirname(target),
					`${rojoName}${RojoFile.META_SUFFIX}`
				),
				kind: "file",
			}
		);
		this.addFolder(own);
		this.repoint(node, `${own}/${base}`, optional);
		await this.children(node, instancePath, undefined);
	}

	private isInitFile(target: string): boolean {
		const placed = this.inputs.placed.find(
			({ source }) => source === target
		);
		return placed !== undefined && SyncbackLayout.makesItsFolder(placed);
	}

	private async keepInit(
		node: RojoNode,
		instancePath: readonly string[],
		target: string,
		optional: boolean,
		at: string | undefined
	): Promise<void> {
		const own = at ?? this.spare();
		const init = `${own}/${RojoFile.INIT_NAME}${this.suffixOf(target)}`;
		const meta = `${own}/${RojoFile.INIT_META}`;
		this.keptNodes.set(own, instancePath);
		this.keptNodes.set(init, instancePath);
		this.keptNodes.set(meta, instancePath);
		this.entries.push(
			{ mirror: init, target, kind: "file" },
			{
				mirror: meta,
				target: path.posix.join(
					path.posix.dirname(target),
					`${this.inputs.fileAt(target).instanceName}${RojoFile.META_SUFFIX}`
				),
				kind: "file",
			}
		);
		this.addFolder(own);
		this.repoint(node, own, optional);
		await this.children(node, instancePath, own, true);
	}

	private isRouteTarget(
		node: RojoNode,
		instancePath: readonly string[]
	): boolean {
		return (
			node.$ignoreUnknownInstances !== true &&
			!STUDIO_FILLED.has(instancePath[0]) &&
			this.inputs.routeTargets.some((target) =>
				isSameJson(target, instancePath)
			)
		);
	}

	private takesChildren(
		node: RojoNode,
		instancePath: readonly string[]
	): boolean {
		if (instancePath.length < 2) return false;
		if (node.$ignoreUnknownInstances === true) return false;
		if (PATH_DROPS_CONTENT.has(node.$className)) return false;
		return this.inOwnTree(instancePath);
	}

	private async keepProject(
		node: RojoNode,
		instancePath: readonly string[],
		target: string,
		optional: boolean
	): Promise<void> {
		const projects: string[] = [];
		const reads: string[] = [];
		const mounts: { read: string; instancePath: readonly string[] }[] = [];
		await this.readsOf(target, instancePath, projects, reads, mounts);
		const folders: string[] = [];
		for (const read of reads)
			if (await this.inputs.isFolder(read)) folders.push(read);
		const inFolder = (file: string) =>
			folders.some(
				(folder) => folder !== file && containsPosix(folder, file)
			);
		const files = reads.filter((read) => !inFolder(read));
		const base = commonFolderPosix([
			...projects.map((project) => path.posix.dirname(project)),
			...files.map((file) =>
				folders.includes(file) ? file : path.posix.dirname(file)
			),
		]);
		const own = this.spare();
		const at = (file: string) =>
			path.posix.join(own, path.posix.relative(base, file));
		for (const project of projects.filter((file) => !inFolder(file)))
			this.entries.push({
				mirror: at(project),
				target: project,
				kind: "file",
			});
		for (const file of files) {
			if (folders.includes(file)) {
				this.entries.push({
					mirror: at(file),
					target: file,
					kind: "folder",
				});
				continue;
			}
			const meta = path.posix.join(
				path.posix.dirname(file),
				`${this.inputs.fileAt(file).instanceName}${RojoFile.META_SUFFIX}`
			);
			this.entries.push(
				{ mirror: at(file), target: file, kind: "file" },
				{ mirror: at(meta), target: meta, kind: "file" }
			);
		}
		this.keptNodes.set(own, instancePath);
		this.keptNodes.set(at(target), instancePath);
		for (const mount of mounts) {
			this.keptNodes.set(at(mount.read), mount.instancePath);
			if (!folders.includes(mount.read))
				this.keptNodes.set(
					at(
						path.posix.join(
							path.posix.dirname(mount.read),
							`${this.inputs.fileAt(mount.read).instanceName}${RojoFile.META_SUFFIX}`
						)
					),
					mount.instancePath
				);
		}
		this.addFolder(own);
		this.repoint(node, at(target), optional);
		await this.children(node, instancePath, undefined);
	}

	private async readsOf(
		project: string,
		instancePath: readonly string[],
		projects: string[],
		reads: string[],
		mounts: { read: string; instancePath: readonly string[] }[]
	): Promise<void> {
		if (projects.includes(project)) return;
		projects.push(project);
		const text = await this.inputs.readText(project);
		const parsed = text === undefined ? undefined : RojoProject.parse(text);
		if (!parsed?.isOk()) return;
		for (const mounted of parsed.value.mountedPaths()) {
			const read = toPosix(
				path.resolve(
					path.dirname(project),
					rojoPathTarget(mounted.path)
				)
			);
			const at = [...instancePath, ...mounted.instancePath];
			mounts.push({ read, instancePath: at });
			if (isProjectFileName(read))
				await this.readsOf(read, at, projects, reads, mounts);
			else if (!reads.includes(read)) reads.push(read);
		}
	}

	private spare(): string {
		return `${KEPT}/${this.kept++}`;
	}

	private repoint(node: RojoNode, mirror: string, optional: boolean): void {
		const at = path.posix.join(this.inputs.root, mirror);
		node.$path = optional ? { optional: at } : at;
	}

	private mount(
		node: RojoNode,
		folder: string,
		instancePath: readonly string[]
	): void {
		node.$path = path.posix.join(this.inputs.root, folder);
		this.keptNodes.set(folder, instancePath);
		this.addFolder(folder);
	}

	private madeFrom(
		node: RojoNode,
		instancePath: readonly string[]
	): string | undefined {
		if (node.$path === undefined) return undefined;
		if (
			Object.keys(node).some(
				(key) => key !== "$path" && key !== "$ignoreUnknownInstances"
			) ||
			childNodes(node).length > 0
		)
			return undefined;
		const target = toPosix(
			path.resolve(this.inputs.dir, rojoPathTarget(node.$path))
		);
		if (!this.inputs.reads.some((read) => containsPosix(read, target)))
			return undefined;
		return this.made.has(instancePath.join("\0")) ? target : undefined;
	}

	private async add(
		target: string,
		at: string,
		name: string,
		folder: string
	): Promise<void> {
		if (await this.inputs.isFolder(target)) {
			this.entries.push({ mirror: at, target, kind: "folder" });
			return;
		}
		const rojoName = this.inputs.fileAt(target).instanceName;
		const inFolder = (file: string) =>
			folder === "" ? file : `${folder}/${file}`;
		this.entries.push({
			mirror: inFolder(`${name}${this.suffixOf(target)}`),
			target,
			kind: "file",
		});
		this.entries.push({
			mirror: inFolder(`${name}${RojoFile.META_SUFFIX}`),
			target: path.posix.join(
				path.posix.dirname(target),
				`${rojoName}${RojoFile.META_SUFFIX}`
			),
			kind: "file",
		});
	}
}
