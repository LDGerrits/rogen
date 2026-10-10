import path from "path";
import { isMatch } from "../../base/glob.js";
import { contains, isInside, samePath, toPosix } from "../../base/path.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { containerClassName, instanceKey } from "../roblox/roblox.js";
import {
	RojoNode,
	RojoProject,
	RojoTree,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { SyncLayout } from "./sync-layout.js";

const NO_TEMPLATE = new RojoProject({ tree: {} });

/** A path on disk that the template mounts at `node`. */
export interface TemplateMount {
	readonly path: string;
	readonly node: readonly string[];
}

/** A mount of the template that `exclude` drops, with the glob that does. */
export interface DroppedMount extends TemplateMount {
	readonly pattern: string;
}

/** The paths the template's own `$path`s mount, which Rojo reads and Rogen leaves alone, and the places a mount can't go. */
export class TemplateMounts {
	constructor(
		private readonly mounts: readonly TemplateMount[],
		/** The template file, which every mount error points at; none without a template. */
		private readonly file: string | undefined,
		/** The mounts `exclude` dropped, which are never built. */
		private readonly dropped: readonly DroppedMount[]
	) {}

	/** The mount at `absolutePath` or above it, which makes Rojo read it. */
	covering(absolutePath: string): TemplateMount | undefined {
		return this.mounts.find((mount) => contains(mount.path, absolutePath));
	}

	/** The mount `exclude` dropped at `absolutePath` or above it. */
	droppedCovering(absolutePath: string): DroppedMount | undefined {
		return this.dropped.find((mount) => contains(mount.path, absolutePath));
	}

	/** Every mounted path, as an absolute POSIX path. */
	get paths(): string[] {
		return this.mounts.map((mount) => toPosix(mount.path));
	}

	/** The mounts at or inside `dir`. */
	inside(dir: string): TemplateMount[] {
		return this.mounts.filter((mount) => isInside(mount.path, dir));
	}

	/** The mount at `absolutePath`, compared as paths, since a case-insensitive file system makes `Vendor` and `vendor` one folder. */
	at(absolutePath: string): TemplateMount | undefined {
		return this.mounts.find((mount) => samePath(mount.path, absolutePath));
	}

	/** A mount at a root dir or above one would hand the whole root dir to Rojo, leaving Rogen nothing to place there. */
	rootDirErrors(rootDirs: readonly string[]): Diagnostic[] {
		const { file } = this;
		if (file === undefined) return [];
		return this.mounts.flatMap(({ path: mounted, node }) => {
			const rootDir = rootDirs.find((dir) => contains(mounted, dir));
			return rootDir === undefined
				? []
				: [
						errorDiagnostic(
							"template.mountsRootDir",
							{ resource: file },
							`"${instanceKey(node)}" mounts ${mounted === rootDir ? `the root dir ${rootDir}` : `${mounted}, which holds the root dir ${rootDir}`}, so Rojo would read all of it and Rogen would place nothing there. Mount a folder inside the root dir, or remove the root dir from "rootDirs".`
						),
					];
		});
	}
}

/** Studio can't drift from disk inside a folder Rogen owns, so unknown children are removed on sync. */
function generatedContainer(instancePath: readonly string[]): RojoNode {
	const $className = containerClassName(instancePath);
	return $className === "Folder"
		? { $className, $ignoreUnknownInstances: false }
		: { $className };
}

/** The template a build merges its generated nodes into, with its `$path`s rebased to the project dir, or a bare DataModel without one. */
export class BuildTemplate {
	private readonly project: RojoProject;
	private readonly templateFile: string | undefined;
	/** The template's `globIgnorePaths`, relative to the project dir. */
	readonly globIgnorePaths: string[];
	/** Every path the template's own `$path`s mount, except those `exclude` drops. Rojo reads these, not Rogen. */
	readonly mounts: TemplateMounts;

	constructor(
		private readonly config: Pick<
			ResolvedConfig,
			"name" | "template" | "exclude"
		>,
		private readonly layout: SyncLayout
	) {
		const { template } = config;
		this.templateFile = template?.file;
		const source =
			template && this.templateDir !== layout.projectDir
				? template.project.rebased((target) => this.rebase(target))
				: template?.project;
		this.globIgnorePaths = source?.globIgnorePaths ?? [];
		this.project = new RojoProject(
			{
				name: config.name,
				tree: source?.getFile().tree ?? { $className: "DataModel" },
			},
			generatedContainer
		);
		this.project.removeNodes(
			(target) => this.droppingGlob(target) !== undefined
		);
		this.mounts = this.mountsOf(source);
	}

	/** Whether the template disables legacy scripts, which leaves scripts under the player containers without a run context. */
	get disablesLegacyScripts(): boolean {
		return this.config.template?.project.emitLegacyScripts === false;
	}

	/** Whether `exclude` drops the node that mounts `target`, a `$path` as the template wrote it: excluded means never built, mounted or scanned. */
	private droppingGlob(target: string): string | undefined {
		const mounted = toPosix(path.resolve(this.layout.projectDir, target));
		return this.config.exclude.find((glob) => isMatch(mounted, glob));
	}

	private mountsOf(
		project: NonNullable<ResolvedConfig["template"]>["project"] | undefined
	): TemplateMounts {
		const all = (project?.getPaths() ?? []).map(
			({ path: rojoPath, instancePath }) => ({
				target: rojoPathTarget(rojoPath),
				mount: {
					path: path.resolve(
						this.layout.projectDir,
						rojoPathTarget(rojoPath)
					),
					node: instancePath,
				},
			})
		);
		return new TemplateMounts(
			all
				.filter(({ target }) => this.droppingGlob(target) === undefined)
				.map(({ mount }) => mount),
			this.templateFile,
			all.flatMap(({ target, mount }) => {
				const pattern = this.droppingGlob(target);
				return pattern === undefined ? [] : [{ ...mount, pattern }];
			})
		);
	}

	getNode(instancePath: readonly string[]): Readonly<RojoNode> | undefined {
		return this.project.getNode(instancePath);
	}

	/** The template with generated containers being what a build creates, ready to have nodes inserted. */
	edit(): RojoProject {
		return new RojoProject(this.project.getFile(), generatedContainer);
	}

	/** The node of `file` the template defines: its own, or a folder of its that the template gives a `$path`, which is that folder's whole content. `source` is the file, or the folder, that names the node. */
	displacing(file: {
		readonly entry: { readonly source: string; readonly rootDir: string };
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

	/** The project file to write: the template's own fields, and `tree` as the tree. */
	toFile(tree: RojoNode, globIgnorePaths: readonly string[]): RojoTree {
		return (this.config.template?.project ?? NO_TEMPLATE).toFile({
			name: this.config.name,
			tree,
			globIgnorePaths,
		});
	}

	private get templateDir(): string {
		return this.templateFile ? path.dirname(this.templateFile) : "";
	}

	/** A template `$path` is real source on disk, so it is rebased, never moved under `syncDir`. */
	private rebase(target: string): string {
		return this.layout.relativeToProject(
			path.resolve(this.templateDir, target)
		);
	}
}
