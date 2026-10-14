import path from "path";
import { contains, isInside, samePath, toPosix } from "../../base/path.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DEFAULT_PROJECT } from "../config/config.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { containerClassName, instanceKey } from "../roblox/roblox.js";
import {
	RojoNode,
	RojoProject,
	RojoProjectFile,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { SyncLayout } from "./sync-layout.js";

interface TreeMount {
	readonly path: string;
	readonly node: readonly string[];
}

/** The paths the tree's own `$path`s mount, which Rojo reads and Rogen leaves alone. */
export class TreeMounts {
	constructor(
		private readonly mounts: readonly TreeMount[],
		private readonly file: string
	) {}

	/** The mount at `absolutePath` or above it, which makes Rojo read it. */
	covering(absolutePath: string): TreeMount | undefined {
		return this.mounts.find((mount) => contains(mount.path, absolutePath));
	}

	/** Every mounted path, as an absolute POSIX path. */
	get paths(): string[] {
		return this.mounts.map((mount) => toPosix(mount.path));
	}

	inside(dir: string): TreeMount[] {
		return this.mounts.filter((mount) => isInside(mount.path, dir));
	}

	/** The mount at `absolutePath`, compared as paths so `Vendor` and `vendor` match on a case-insensitive file system. */
	at(absolutePath: string): TreeMount | undefined {
		return this.mounts.find((mount) => samePath(mount.path, absolutePath));
	}

	sourcePathErrors(sourcePaths: readonly string[]): Diagnostic[] {
		return this.mounts.flatMap(({ path: mounted, node }) => {
			const sourcePath = sourcePaths.find((dir) =>
				contains(mounted, dir)
			);
			return sourcePath === undefined
				? []
				: [
						errorDiagnostic(
							"tree.mountsSourcePath",
							{ resource: this.file },
							`"${instanceKey(node)}" mounts ${mounted === sourcePath ? `the source path ${sourcePath}` : `${mounted}, which holds the source path ${sourcePath}`}, so Rojo would read all of it and Rogen would place nothing there. Mount a folder inside the source path, or remove the source path from "sourcePaths".`
						),
					];
		});
	}
}

function generatedContainer(instancePath: readonly string[]): RojoNode {
	const $className = containerClassName(instancePath);
	return $className === "Folder"
		? { $className, $ignoreUnknownInstances: false }
		: { $className };
}

/** The tree a build merges its generated nodes into: the config's own, with its `$path`s kept relative to the project dir. */
export class BuildTree {
	private readonly project: RojoProject;
	/** The config's `globIgnorePaths` as Rojo reads them, relative to the project dir. */
	readonly globIgnorePaths: string[];
	/** Every path the tree's own `$path`s mount. Rojo reads these, not Rogen. */
	readonly mounts: TreeMounts;

	constructor(
		private readonly config: Pick<
			ResolvedConfig,
			"file" | "project" | "projectDir" | "stem" | "projectName"
		>,
		private readonly layout: SyncLayout
	) {
		const { project } = config;
		this.globIgnorePaths = project.globIgnorePaths.map((glob) =>
			layout.syncedGlob(glob)
		);
		this.project = new RojoProject(
			{ tree: project.getFile().tree },
			generatedContainer
		);
		this.mounts = this.mountsOf(project);
	}

	get disablesLegacyScripts(): boolean {
		return this.config.project.emitLegacyScripts === false;
	}

	private mountsOf(project: ResolvedConfig["project"]): TreeMounts {
		return new TreeMounts(
			project.mountedPaths().map(({ path: rojoPath, instancePath }) => ({
				path: path.resolve(
					this.layout.projectDir,
					rojoPathTarget(rojoPath)
				),
				node: instancePath,
			})),
			this.config.file
		);
	}

	getNode(instancePath: readonly string[]): Readonly<RojoNode> | undefined {
		return this.project.getNode(instancePath);
	}

	edit(): RojoProject {
		return new RojoProject(this.project.getFile(), generatedContainer);
	}

	/** The node of `file` the tree defines: its own, or a folder of its that the tree gives a `$path`; `source` is the file, or the folder, that names the node. */
	displacing(file: {
		readonly entry: {
			readonly source: string;
			readonly sourcePath: string;
		};
		readonly instancePath: readonly string[];
		readonly folderNodes: readonly {
			readonly folder: string;
			readonly instancePath: readonly string[];
		}[];
	}):
		| { readonly node: readonly string[]; readonly source: string }
		| undefined {
		const mounted = file.folderNodes.find(
			({ instancePath }) =>
				this.getNode(instancePath)?.$path !== undefined
		);
		const node =
			mounted?.instancePath ??
			(this.getNode(file.instancePath) ? file.instancePath : undefined);
		if (!node) return undefined;
		const folder = file.folderNodes.find(
			({ instancePath }) =>
				instanceKey(instancePath) === instanceKey(node)
		);
		return {
			node,
			source: folder ? folder.folder : file.entry.source,
		};
	}

	/** The project file to write; Rojo names `default.project.json` after its folder, but crashes on any other project file without a `name`. */
	toFile(
		tree: RojoNode,
		globIgnorePaths: readonly string[]
	): RojoProjectFile {
		const file = this.config.project.toFile({ tree, globIgnorePaths });
		return this.config.stem === DEFAULT_PROJECT || file.name !== undefined
			? file
			: { ...file, name: this.config.projectName };
	}
}
