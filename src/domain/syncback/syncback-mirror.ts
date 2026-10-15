import path from "path";
import { isGlobsetMatch } from "../../base/glob.js";
import { isObject } from "../../base/objects.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { PlacedLocation } from "../build/build-service.js";
import { RojoFile } from "../rojo/rojo.js";
import {
	RojoNode,
	RojoProjectFile,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { SyncRule } from "../rojo/sync-rules.js";

/** Names that are safe to use as a folder or file name on every system. */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/;

/** The sync rule Rojo's syncback stops on: it can't write a script it reads as a legacy LocalScript. */
const UNSYNCABLE_USE = "legacyClientScript";

const childrenOf = (node: RojoNode): [string, RojoNode][] =>
	Object.entries(node).filter(
		(entry): entry is [string, RojoNode] =>
			!entry[0].startsWith("$") && isObject(entry[1])
	);

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
	/** The absolute folders the build's `$path`s point into: the source paths and the sync path. */
	readonly reads: readonly string[];
	/** How Rojo reads the file at an absolute path written with `/`. */
	readonly fileAt: (target: string) => RojoFile;
	readonly isFolder: (target: string) => Promise<boolean>;
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
		await walk.children(file.tree, [], "");
		return new SyncbackMirror(file, walk.entries, walk.folders, rules);
	}

	/** The mirror folder of the instance at `node`, relative to the mirror's root. */
	static folderOf(node: readonly string[]): string {
		return node.join("/");
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

	/** The project file or folder a path of the mirror stands for; none for a path no entry holds, which is a new instance. */
	targetOf(mirror: string): string | undefined {
		for (const entry of this.entries) {
			if (entry.mirror === mirror) return entry.target;
			if (
				entry.kind === "folder" &&
				mirror.startsWith(`${entry.mirror}/`)
			)
				return path.posix.join(
					entry.target,
					mirror.slice(entry.mirror.length + 1)
				);
		}
		return undefined;
	}
}

class MirrorWalk {
	readonly entries: MirrorEntry[] = [];
	readonly folders: string[] = [];

	constructor(private readonly inputs: SyncbackMirrorInputs) {}

	/** Moves the children of `node` that the build made into the mirror folder `folder`; whether any moved. */
	async children(
		node: RojoNode,
		instancePath: readonly string[],
		folder: string
	): Promise<boolean> {
		let moved = false;
		for (const [name, child] of childrenOf(node)) {
			const here = [...instancePath, name];
			const at = folder === "" ? name : `${folder}/${name}`;
			if (!SAFE_NAME.test(name)) continue;
			const target = this.madeFrom(child, here);
			if (target !== undefined) {
				await this.add(target, at, name, folder);
				delete node[name];
				moved = true;
				continue;
			}
			if (isPlainFolder(child) && instancePath.length > 0) {
				await this.children(child, here, at);
				this.folders.push(at);
				if (childrenOf(child).length === 0) delete node[name];
				else this.mount(child, at);
				moved = true;
				continue;
			}
			if (child.$path !== undefined) continue;
			if (await this.children(child, here, at)) this.mount(child, at);
		}
		return moved;
	}

	private mount(node: RojoNode, folder: string): void {
		node.$path = path.posix.join(this.inputs.root, folder);
		if (!this.folders.includes(folder)) this.folders.push(folder);
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
			childrenOf(node).length > 0
		)
			return undefined;
		const target = toPosix(
			path.resolve(this.inputs.dir, rojoPathTarget(node.$path))
		);
		if (!this.inputs.reads.some((read) => containsPosix(read, target)))
			return undefined;
		const made = this.inputs.placed.some(
			(file) =>
				file.instancePath.length >= instancePath.length &&
				instancePath.every((name, at) => file.instancePath[at] === name)
		);
		return made ? target : undefined;
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
