import { Result } from "../../base/result.js";
import { containsPosix, normalizeDir } from "../../base/path.js";
import { RogenConfig } from "../config/config.js";
import {
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

/** The Rojo project `init` starts a config from: what it mounts, and what a lift of a hand-written project file leaves out or gains. */
export class StarterProject {
	private constructor(
		private readonly project: RojoProject<ParsedProjectFile>
	) {}

	/** A DataModel that mounts `mounts`, each at its landing. */
	static fromMounts(mounts: readonly Mount[]): StarterProject {
		const project = new RojoProject<ParsedProjectFile>({
			tree: { $className: "DataModel" },
		});
		for (const mount of mounts)
			project.insertNode(mount.landing.split("/"), mountNode(mount));
		return new StarterProject(project);
	}

	/** Fails when `text` isn't a project file. */
	static parse(text: string): Result<StarterProject, Error> {
		return RojoProject.parse(text).map(
			(project) => new StarterProject(project)
		);
	}

	/** This project without the nodes that point into `dirs`, each with its `$path` and where it was; `undefined` when a dir is the whole folder. */
	withoutNodesIn(
		dirs: readonly string[]
	): { project: StarterProject; removed: MountedPath[] } | undefined {
		const claimed = dirs.map(normalizeDir);
		if (claimed.includes(".")) return undefined;

		const edited = this.copy();
		const removed = edited.removeNodes((target) =>
			claimed.some((dir) => containsPosix(dir, normalizeDir(target)))
		);
		return { project: new StarterProject(edited), removed };
	}

	/** This project plus the `mounts` it lacks, as `<path> at <node>`; a node already there wins and its mounts are `skipped`. */
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
			project: new StarterProject(edited),
			added: added.map(describe),
			skipped: skipped.map(describe),
		};
	}

	/** The project as a config's keys: Rojo's, without the schema, which the config brings its own. */
	toConfig(): RogenConfig {
		const { $schema: _schema, ...keys } = this.project.getFile();
		return keys as RogenConfig;
	}

	private copy(): RojoProject<ParsedProjectFile> {
		return new RojoProject(this.project.getFile());
	}
}
