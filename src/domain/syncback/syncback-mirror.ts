import path from "path";
import { isGlobsetMatch } from "../../base/glob.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { PlacedLocation } from "../write/write-service.js";
import { RojoFile } from "../rojo/rojo.js";
import {
	RojoNode,
	RojoProject,
	RojoProjectFile,
	childNodes,
	isProjectFileName,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { SyncRule } from "../rojo/sync-rules.js";

/** Names that are safe to use as a folder or file name on every system. */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/;

/** The sync rule Rojo's syncback stops on: it can't write a script it reads as a legacy LocalScript. */
const UNSYNCABLE_USE = "legacyClientScript";

const isPlainFolder = (node: RojoNode): boolean =>
	node.$className === "Folder" &&
	Object.keys(node).every(
		(key) =>
			!key.startsWith("$") ||
			key === "$className" ||
			key === "$ignoreUnknownInstances"
	);

/** A file or folder of the project, copied into the mirror where Rojo finds the instance it makes. */
export interface MirrorEntry {
	/** Relative to the mirror's root, written with `/`. */
	readonly mirror: string;
	/** Absolute, written with `/`: what Rojo reads in the project. */
	readonly target: string;
	readonly kind: "file" | "folder";
}

export interface SyncbackMirrorInputs {
	/** The project file a build wrote, which every `$path` in is relative to `dir`. */
	readonly written: RojoProjectFile;
	/** The config's folder, where the temporary project file goes. */
	readonly dir: string;
	/** Where the mirror goes, relative to `dir` and written with `/`. */
	readonly root: string;
	/** The files the build placed, which tell a node it made from a node of the user's tree. */
	readonly placed: readonly PlacedLocation[];
	/** The absolute folders the build's `$path`s point into: the source paths and the compiled path. */
	readonly reads: readonly string[];
	/** How Rojo reads the file at an absolute path written with `/`. */
	readonly fileAt: (target: string) => RojoFile;
	readonly isFolder: (target: string) => Promise<boolean>;
	/** The text of the file at an absolute path written with `/`; none when it can't be read. */
	readonly readText: (target: string) => Promise<string | undefined>;
}

/** The deepest folder that holds every one of `targets`, absolute and written with `/`. */
function commonFolder(targets: readonly string[]): string {
	let folder = targets[0];
	for (const target of targets)
		while (!containsPosix(folder, target))
			folder = path.posix.dirname(folder);
	return folder;
}

/** The project file Rojo's syncback runs on: the written one, with every node the build made from a file or a plain folder moved into a mirror folder laid out by instance path, so Rojo edits, adds and removes there as in a plain Rojo project. */
export class SyncbackMirror {
	private constructor(
		readonly file: RojoProjectFile,
		readonly entries: readonly MirrorEntry[],
		/** Mirror folders to make even when no file lands in them: plain folders the build made, and the folders nodes are mounted at; relative to the mirror's root. */
		readonly folders: readonly string[],
		/** The sync rules of the written file, which apply to the mirror once its files are known. */
		private readonly rules: readonly SyncRule[]
	) {}

	static async of(inputs: SyncbackMirrorInputs): Promise<SyncbackMirror> {
		const file = structuredClone(inputs.written);
		const rules = (file.syncRules ?? []).filter(
			(rule) => rule.use !== UNSYNCABLE_USE
		);
		delete file.syncRules;
		const walk = new MirrorWalk(inputs);
		if (file.tree.$path === undefined)
			await walk.children(file.tree, [], "");
		else await walk.keep(file.tree, [], undefined);
		SyncbackMirror.assertInside(file, inputs.root);
		return new SyncbackMirror(file, walk.entries, walk.folders, rules);
	}

	/** Throws at a `$path` outside the mirror, which would let Rojo's syncback write the project's own files. */
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

	/** The written sync rules, each for the mirror files whose target it matched: Rogen's own rules name single files, so each is turned into one rule per file. */
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

	/** The project file or folder a path of the mirror stands for: the entry that is it, else the deepest folder entry it is in; none for a path no entry holds, which is a new instance. */
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

	/** Mirror paths that two entries share, or that differ only in letter case, which a case-blind file system would make one file; each with the project paths behind it. */
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

/** Where a node the project keeps reads its own file or folder from in the mirror; no instance is named so, as `~` is no safe name. */
const KEPT = "~kept";

class MirrorWalk {
	readonly entries: MirrorEntry[] = [];
	readonly folders: string[] = [];
	private kept = 0;

	/** Every instance path a placed file is at or below, joined with `\0`. */
	private readonly made = new Set<string>();
	private readonly folderSet = new Set<string>();

	constructor(private readonly inputs: SyncbackMirrorInputs) {
		for (const { instancePath } of inputs.placed)
			for (let depth = 1; depth <= instancePath.length; depth++)
				this.made.add(instancePath.slice(0, depth).join("\0"));
	}

	private addFolder(folder: string): void {
		if (this.folderSet.has(folder)) return;
		this.folderSet.add(folder);
		this.folders.push(folder);
	}

	/** Moves the children of `node` that the build made into the mirror folder `folder`, and points every other child at a copy in the mirror, so Rojo writes nothing outside it; whether any moved. With no `folder`, every child stays a node. A `node` that already reads `folder` by its `$path` is `mounted`. */
	async children(
		node: RojoNode,
		instancePath: readonly string[],
		folder: string | undefined,
		mounted = false
	): Promise<boolean> {
		let moved = false;
		const children = childNodes(node);
		/** A node kept inside the folder its parent reads would be read twice, so it gets a folder of its own. */
		const mounts =
			folder !== undefined &&
			(mounted ||
				children.some(([name, child]) =>
					this.movable(name, child, instancePath)
				));
		for (const [name, child] of children) {
			const here = [...instancePath, name];
			const at =
				folder !== undefined && SAFE_NAME.test(name)
					? folder === ""
						? name
						: `${folder}/${name}`
					: undefined;
			if (at !== undefined && folder !== undefined) {
				const target = this.madeFrom(child, here);
				if (target !== undefined) {
					await this.add(target, at, name, folder);
					delete node[name];
					moved = true;
					continue;
				}
				if (instancePath.length > 0 && this.madeWhole(child, here)) {
					await this.children(child, here, at);
					this.addFolder(at);
					delete node[name];
					moved = true;
					continue;
				}
			}
			await this.keep(child, here, mounts ? undefined : at);
		}
		return moved;
	}

	/** Whether `children` moves the child `name` of the node at `instancePath` into the folder it reads. */
	private movable(
		name: string,
		child: RojoNode,
		instancePath: readonly string[]
	): boolean {
		const here = [...instancePath, name];
		return (
			SAFE_NAME.test(name) &&
			(this.madeFrom(child, here) !== undefined ||
				(instancePath.length > 0 && this.madeWhole(child, here)))
		);
	}

	/** Whether `node` is a plain folder whose every child the build made, so its folder can lie inside the one of its parent. */
	private madeWhole(
		node: RojoNode,
		instancePath: readonly string[]
	): boolean {
		return (
			isPlainFolder(node) &&
			childNodes(node).every(([name, child]) =>
				this.movable(name, child, instancePath)
			)
		);
	}

	/** A node the project file keeps: what it reads from disk is copied into the mirror and its `$path` points there. */
	async keep(
		node: RojoNode,
		instancePath: readonly string[],
		at: string | undefined
	): Promise<void> {
		if (node.$path === undefined) {
			const own = at ?? this.spare();
			if (await this.children(node, instancePath, own))
				this.mount(node, own);
			return;
		}
		const target = toPosix(
			path.resolve(this.inputs.dir, rojoPathTarget(node.$path))
		);
		const optional = typeof node.$path !== "string";
		if (await this.inputs.isFolder(target)) {
			const own = at ?? this.spare();
			this.entries.push({ mirror: own, target, kind: "folder" });
			this.repoint(node, own, optional);
			await this.children(node, instancePath, own, true);
			return;
		}
		if (isProjectFileName(target)) {
			await this.keepProject(node, instancePath, target, optional);
			return;
		}
		const own = this.spare();
		const base = path.posix.basename(target);
		const rojoName = this.inputs.fileAt(target).instanceName;
		this.entries.push(
			{ mirror: `${own}/${base}`, target, kind: "file" },
			{
				mirror: `${own}/${rojoName}${RojoFile.META_SUFFIX}`,
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

	/** A nested project file, copied with every file and folder it and the project files it nests read, laid out as they lie on disk, since its `$path`s are relative to it. */
	private async keepProject(
		node: RojoNode,
		instancePath: readonly string[],
		target: string,
		optional: boolean
	): Promise<void> {
		const projects: string[] = [];
		const reads: string[] = [];
		await this.readsOf(target, projects, reads);
		const folders: string[] = [];
		for (const read of reads)
			if (await this.inputs.isFolder(read)) folders.push(read);
		const inFolder = (file: string) =>
			folders.some(
				(folder) => folder !== file && containsPosix(folder, file)
			);
		const files = reads.filter((read) => !inFolder(read));
		const base = commonFolder([
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
		this.addFolder(own);
		this.repoint(node, at(target), optional);
		await this.children(node, instancePath, undefined);
	}

	/** Adds `project` and every project file it nests to `projects`, and what their `$path`s point at to `reads`. */
	private async readsOf(
		project: string,
		projects: string[],
		reads: string[]
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
			if (isProjectFileName(read))
				await this.readsOf(read, projects, reads);
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

	private mount(node: RojoNode, folder: string): void {
		node.$path = path.posix.join(this.inputs.root, folder);
		this.addFolder(folder);
	}

	/** The file or folder a node of the build points at, when the build made the node from it; none for a node of the user's own tree. */
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
		const base = path.posix.basename(target);
		const rojoName = this.inputs.fileAt(target).instanceName;
		const suffix = base.startsWith(rojoName)
			? base.slice(rojoName.length)
			: path.posix.extname(base);
		const inFolder = (file: string) =>
			folder === "" ? file : `${folder}/${file}`;
		this.entries.push({
			mirror: inFolder(`${name}${suffix}`),
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
