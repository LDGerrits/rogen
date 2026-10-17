import path from "path";
import { toPosix } from "../../../base/path.js";
import {
	FileReader,
	FileType,
	isDirectoryType,
} from "../../../platform/fs/file-system-service.js";
import { InstanceReference } from "../../roblox/roblox.js";
import { RojoFile } from "../../rojo/rojo.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { MountedLocation } from "../build-service.js";
import { TreeMount, TreeMounts } from "../build-tree.js";

/** Reads the folders and files a tree's `$path`s mount as Rojo does, so `where` answers for what Rogen leaves to Rojo: a package, a folder with an init file, a plain Rojo project. */
export class MountedInstances {
	constructor(
		private readonly fileReader: FileReader,
		private readonly mounts: TreeMounts,
		private readonly rules: SyncRules
	) {}

	/** The instance that `source`, inside the mount covering it, becomes; none when Rojo reads no instance from it. */
	async instanceOf(source: string): Promise<readonly string[] | undefined> {
		const mount = this.mounts.covering(source);
		if (!mount) return undefined;
		const root = toPosix(mount.path);
		const relative = path.posix.relative(root, toPosix(source));
		if (relative === "") return mount.node;
		if (relative.startsWith("..")) return undefined;
		const names = relative.split("/");
		const leaf = names.pop()!;
		const folders = [...mount.node, ...names];
		const full = path.posix.join(root, relative);
		if (await this.fileReader.isDirectory(full)) return [...folders, leaf];
		return this.instanceOfFile(leaf, folders, full);
	}

	private instanceOfFile(
		name: string,
		folder: readonly string[],
		full: string
	): readonly string[] | undefined {
		if (RojoFile.isInitMeta(name)) return folder;
		const metaOf = RojoFile.metaStemOf(name);
		if (metaOf !== undefined) return [...folder, metaOf];
		const file = RojoFile.at(full, this.rules);
		if (file.isDefaultProject || file.isInit) return folder;
		if (file.kind === undefined || file.isProject) return undefined;
		return [...folder, file.instanceName];
	}

	/** The mounted files and folders that make `reference`, or a mount inside it. */
	async filesAt(reference: InstanceReference): Promise<MountedLocation[]> {
		const names = reference.text.split(reference.separator);
		const found: MountedLocation[] = [];
		for (const mount of this.mounts.all) {
			const rest = names.slice(mount.node.length);
			const within = mount.node.every(
				(name, at) => at >= names.length || name === names[at]
			);
			if (!within) continue;
			const source =
				rest.length > 0
					? await this.walk(mount, rest)
					: await this.rootOf(mount);
			if (source !== undefined)
				found.push({
					status: "mounted",
					source,
					exists: true,
					node: mount.node,
					instancePath:
						names.length >= mount.node.length ? names : mount.node,
				});
		}
		return found;
	}

	/** The init file of a mounted folder, which is the instance of the folder itself, else the mounted path. */
	private async rootOf(mount: TreeMount): Promise<string> {
		const root = toPosix(mount.path);
		return (await this.fileReader.isDirectory(root))
			? ((await this.initFileIn(root)) ?? root)
			: root;
	}

	private async walk(
		mount: TreeMount,
		names: readonly string[]
	): Promise<string | undefined> {
		let directory = toPosix(mount.path);
		if (!(await this.fileReader.isDirectory(directory))) return undefined;
		for (const [at, name] of names.entries()) {
			const entries = await this.fileReader.readDirectory(directory);
			const last = at === names.length - 1;
			const folder = entries.find(
				([entry, type]) => entry === name && isDirectoryType(type)
			);
			if (folder) {
				const inside = path.posix.join(directory, name);
				if (last) return (await this.initFileIn(inside)) ?? inside;
				directory = inside;
				continue;
			}
			if (!last) return undefined;
			const file = entries.find(
				([entry, type]: [string, FileType]) =>
					!isDirectoryType(type) &&
					this.instanceNameOf(directory, entry) === name
			);
			return file && path.posix.join(directory, file[0]);
		}
		return undefined;
	}

	private instanceNameOf(
		directory: string,
		entry: string
	): string | undefined {
		const file = RojoFile.at(path.posix.join(directory, entry), this.rules);
		return file.kind === undefined ||
			file.isInit ||
			file.isDefaultProject ||
			file.isProject
			? undefined
			: file.instanceName;
	}

	private async initFileIn(directory: string): Promise<string | undefined> {
		const entries = await this.fileReader.readDirectory(directory);
		const init = entries.find(([entry]) => RojoFile.INIT_FILES.has(entry));
		return init && path.posix.join(directory, init[0]);
	}
}
