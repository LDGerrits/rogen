import { Result } from "../../base/result.js";
import { containsPosix, normalizeDir } from "../../base/path.js";
import { RogenConfig } from "../config/config.js";
import {
	RemovedMount,
	MountedPath,
	ParsedProjectFile,
	ProjectFile,
	RojoNode,
	RojoProject,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { Mount } from "../toolchain/toolchain.js";
import { instanceKey } from "../roblox/roblox.js";

const mountNode = ({ path, optional }: Mount): Partial<RojoNode> => ({
	$path: optional ? { optional: path } : path,
});

const describe = ({ path, instancePath }: MountedPath): string =>
	`${normalizeDir(rojoPathTarget(path))} at ${instanceKey(instancePath)}`;

export class StarterProject {
	private constructor(
		private readonly project: RojoProject<ParsedProjectFile>,
		/** The folders that hold an init file, as `normalizeDir` writes them. */
		private readonly holdingInit: ReadonlySet<string> = new Set()
	) {}

	static fromMounts(mounts: readonly Mount[]): StarterProject {
		const project = new RojoProject<ParsedProjectFile>({
			tree: { $className: "DataModel" },
		});
		for (const mount of mounts)
			project.insertNode(mount.landing.split("/"), mountNode(mount));
		return new StarterProject(project);
	}

	static parse(text: string): Result<StarterProject, Error> {
		return RojoProject.parse(text).map(
			(project) => new StarterProject(project)
		);
	}

	/** Whether routes can place code in the tree: its root is a DataModel, or names no class and mounts nothing. A model or a plugin has a `$path` at its root instead. */
	get takesRoutes(): boolean {
		const root = this.project.getNode([]);
		return (
			root?.$className === "DataModel" ||
			(root?.$className === undefined && root?.$path === undefined)
		);
	}

	/** Every folder the tree mounts, as `normalizeDir` writes it. */
	mountedFolders(): string[] {
		return [
			...new Set(
				this.project
					.mountedPaths()
					.map(({ path }) => normalizeDir(rojoPathTarget(path)))
			),
		];
	}

	/** The same project, told which of its mounted folders hold an init file: Rojo reads such a folder as one instance, which a route can't make, so the mount stays in the tree. */
	withInitIn(folders: readonly string[]): StarterProject {
		return new StarterProject(
			this.copy(),
			new Set(folders.map(normalizeDir))
		);
	}

	/** The mounts below `dirs` that stay in the tree because their folder holds an init file. */
	keptMounts(dirs: readonly string[]): MountedPath[] {
		const claimed = dirs.map(normalizeDir);
		return this.project
			.mountedPaths()
			.filter(
				({ path, instancePath }) =>
					instancePath.length > 0 &&
					this.holdsInit(rojoPathTarget(path)) &&
					claimed.some((dir) =>
						containsPosix(dir, normalizeDir(rojoPathTarget(path)))
					)
			);
	}

	/** Takes the mounts into `dirs` out of the tree, but those that hold an init file. */
	withoutNodesIn(
		dirs: readonly string[]
	): { project: StarterProject; removed: RemovedMount[] } | undefined {
		const claimed = dirs.map(normalizeDir);
		if (claimed.includes(".")) return undefined;

		const edited = this.copy();
		const removed = edited.removeNodes(
			(target) =>
				!this.holdsInit(target) &&
				claimed.some((dir) => containsPosix(dir, normalizeDir(target)))
		);
		return {
			project: new StarterProject(edited, this.holdingInit),
			removed,
		};
	}

	/** Puts each removed mount back on the tree: with its `$path` when `withPath`, else as the settings it carried. A mount with none of those is left out. */
	withMountsReturned(
		mounts: readonly RemovedMount[],
		withPath: boolean
	): StarterProject {
		const edited = this.copy();
		for (const { path, instancePath, settings } of mounts) {
			const node = withPath
				? { ...settings, $path: path }
				: StarterProject.folderOf(instancePath, settings);
			if (Object.keys(node).length > 0)
				edited.insertNode(instancePath, node);
		}
		return new StarterProject(edited, this.holdingInit);
	}

	/** A node already there wins and its mounts are `skipped`. */
	withMounts(mounts: readonly Mount[]): {
		project: StarterProject;
		added: string[];
		skipped: string[];
	} {
		const mounted = this.project
			.mountedPaths()
			.map(({ path }) => normalizeDir(rojoPathTarget(path)));
		const missing = mounts.filter(
			(mount) =>
				!mounted.some((dir) =>
					containsPosix(dir, normalizeDir(mount.path))
				)
		);
		const additions = new RojoProject<ProjectFile>({ tree: {} });
		for (const mount of missing)
			additions.insertNode(mount.landing.split("/"), mountNode(mount));

		const edited = this.copy();
		const { added, skipped } = edited.mergeMissing(additions);
		return {
			project: new StarterProject(edited, this.holdingInit),
			added: added.map(describe),
			skipped: skipped.map(describe),
		};
	}

	/** What a node with no `$path` left is: a folder, which is what Rojo made of the `$path`, unless it carries a class or is a service. */
	private static folderOf(
		instancePath: readonly string[],
		settings: Readonly<RojoNode>
	): RojoNode {
		const carried = Object.keys(settings).length > 0;
		return carried &&
			settings.$className === undefined &&
			instancePath.length > 1
			? { $className: "Folder", ...settings }
			: { ...settings };
	}

	private holdsInit(target: string): boolean {
		return this.holdingInit.has(normalizeDir(target));
	}

	toConfig(): RogenConfig {
		const { $schema: _schema, ...keys } = this.project.getFile();
		return keys as RogenConfig;
	}

	private copy(): RojoProject<ParsedProjectFile> {
		return new RojoProject(this.project.getFile());
	}
}
