import path from "path";
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
import { WrittenTree } from "../rojo/project-text.js";
import { SampleGame } from "./sample-game.js";

const mountNode = ({ path, optional }: Mount): Partial<RojoNode> => ({
	$path: optional ? { optional: path } : path,
});

const describe = ({ path, instancePath }: MountedPath): string =>
	`${normalizeDir(rojoPathTarget(path))} at ${instanceKey(instancePath)}`;

export const ROJO_TEMPLATE_NODES: Readonly<Record<string, readonly string[]>> =
	{
		shared: ["ReplicatedStorage", "Shared"],
		server: ["ServerScriptService", "Server"],
		client: ["StarterPlayer", "StarterPlayerScripts", "Client"],
	};

export class StarterProject {
	private constructor(
		private readonly project: RojoProject<ParsedProjectFile>,
		private readonly holdingInit: ReadonlySet<string> = new Set(),
		readonly written?: WrittenTree
	) {}

	static fromMounts(
		mounts: readonly Mount[],
		game?: SampleGame
	): StarterProject {
		const project = new RojoProject<ParsedProjectFile>({
			tree: { $className: "DataModel" },
		});
		if (game)
			for (const [service, node] of Object.entries(game.nodes()))
				project.insertNodeReplacingFolder([service], node);
		for (const mount of mounts)
			project.insertNodeReplacingFolder(
				mount.landing.split("/"),
				mountNode(mount)
			);
		return new StarterProject(project);
	}

	static ofRojoTemplate(folders: readonly string[]): StarterProject {
		const tree: RojoNode = { $className: "DataModel" };
		for (const folder of folders) {
			const names =
				ROJO_TEMPLATE_NODES[path.posix.basename(folder).toLowerCase()];
			let node = tree;
			for (const name of names) {
				node[name] ??= {};
				node = node[name] as RojoNode;
			}
			node.$path = folder;
		}
		return new StarterProject(new RojoProject<ParsedProjectFile>({ tree }));
	}

	static ofScript(folder = "src"): StarterProject {
		return new StarterProject(
			new RojoProject<ParsedProjectFile>({ tree: { $path: folder } })
		);
	}

	static parse(text: string): Result<StarterProject, Error> {
		return RojoProject.parse(text).map(
			(project) =>
				new StarterProject(project, new Set(), WrittenTree.of(text))
		);
	}

	get takesRoutes(): boolean {
		const root = this.project.getNode([]);
		return (
			root?.$className === "DataModel" ||
			(root?.$className === undefined && root?.$path === undefined)
		);
	}

	get rootPath(): string | undefined {
		const mounted = this.project.getNode([])?.$path;
		return mounted === undefined ? undefined : rojoPathTarget(mounted);
	}

	get name(): string | undefined {
		const { name } = this.project.getFile();
		return typeof name === "string" ? name : undefined;
	}

	mountedFolders(): string[] {
		return [
			...new Set(
				this.project
					.mountedPaths()
					.map(({ path }) => normalizeDir(rojoPathTarget(path)))
			),
		];
	}

	withInitIn(folders: readonly string[]): StarterProject {
		return new StarterProject(
			this.copy(),
			new Set(folders.map(normalizeDir)),
			this.written
		);
	}

	keptMounts(dirs: readonly string[]): MountedPath[] {
		const claimed = dirs.map(normalizeDir);
		if (claimed.includes(".")) return [];
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
			project: new StarterProject(edited, this.holdingInit, this.written),
			removed,
		};
	}

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
				edited.insertNodeReplacingFolder(instancePath, node);
		}
		return new StarterProject(edited, this.holdingInit, this.written);
	}

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
			additions.insertNodeReplacingFolder(
				mount.landing.split("/"),
				mountNode(mount)
			);

		const edited = this.copy();
		const { added, skipped } = edited.mergeMissing(additions);
		return {
			project: new StarterProject(edited, this.holdingInit, this.written),
			added: added.map(describe),
			skipped: skipped.map(describe),
		};
	}

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

	holdsInit(target: string): boolean {
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
