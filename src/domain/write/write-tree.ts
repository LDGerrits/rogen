import path from "path";
import { contains, isInside, samePath, toPosix } from "../../base/path.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { containerClassName, instanceKey } from "../roblox/roblox.js";
import {
	RojoNode,
	RojoProject,
	RojoProjectFile,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { SyncRule } from "../rojo/sync-rules.js";
import { CompiledLayout } from "./compiled-layout.js";
import { WrittenGlobs } from "./written-globs.js";

export interface TreeMount {
	readonly path: string;
	readonly node: readonly string[];
}

export class TreeMounts {
	constructor(
		private readonly mounts: readonly TreeMount[],
		private readonly file: string
	) {}

	get all(): readonly TreeMount[] {
		return this.mounts;
	}

	covering(absolutePath: string): TreeMount | undefined {
		return this.mounts.find((mount) => contains(mount.path, absolutePath));
	}

	get paths(): string[] {
		return this.mounts.map((mount) => toPosix(mount.path));
	}

	inside(dir: string): TreeMount[] {
		return this.mounts.filter((mount) => isInside(mount.path, dir));
	}

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
							`"${instanceKey(node)}" mounts ${mounted === sourcePath ? `the source path ${sourcePath}` : `${mounted}, which holds the source path ${sourcePath}`}, so Rogen would place nothing there. Mount a folder inside it, or remove the source path.`
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

export class WriteTree {
	private readonly project: RojoProject;
	readonly globIgnorePaths: string[];
	readonly mounts: TreeMounts;
	readonly globs: WrittenGlobs;

	constructor(
		private readonly config: Pick<
			ResolvedConfig,
			"file" | "project" | "projectDir"
		>,
		private readonly layout: CompiledLayout
	) {
		const { project } = config;
		this.project = new RojoProject(
			{ tree: project.getFile().tree },
			generatedContainer
		);
		this.mounts = this.mountsOf(project);
		this.globs = new WrittenGlobs(layout, this.mounts.paths);
		this.globIgnorePaths = project.globIgnorePaths.flatMap((glob) =>
			this.globs.of(glob)
		);
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

	toFile(
		tree: RojoNode,
		globIgnorePaths: readonly string[],
		syncRules: readonly SyncRule[]
	): RojoProjectFile {
		return this.config.project.toFile({
			tree,
			globIgnorePaths,
			syncRules,
		});
	}
}
