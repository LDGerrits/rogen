import path from "path";
import { joinPosix } from "../../base/path.js";
import { ResolvedConfig } from "../config/config.js";
import { containerClassName } from "../roblox/roblox.js";
import {
	RojoNode,
	RojoProject,
	RojoTree,
	instanceKey,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { SyncLayout } from "./sync-layout.js";

const NO_TEMPLATE = new RojoProject({ tree: {} });

/** A path on disk that the template mounts at `node`. */
export interface TemplateMount {
	readonly path: string;
	readonly node: readonly string[];
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

	constructor(
		private readonly config: Pick<ResolvedConfig, "name" | "template">,
		private readonly layout: SyncLayout
	) {
		const { template } = config;
		this.templateFile = template?.file;
		this.project = new RojoProject(
			{
				name: config.name,
				tree: template?.project.getTree().tree ?? {
					$className: "DataModel",
				},
			},
			generatedContainer
		);
		if (template && this.templateDir !== layout.projectDir) {
			this.project.mapPaths((target) => this.rebase(target));
		}
	}

	/** Whether the template disables legacy scripts, which leaves scripts under the player containers without a run context. */
	get disablesLegacyScripts(): boolean {
		return this.config.template?.project.emitLegacyScripts === false;
	}

	/** Every path the template's own `$path`s mount, absolute, with the node that mounts it. Rojo reads these, not Rogen. */
	get mounts(): TemplateMount[] {
		const project = this.config.template?.project;
		if (!project) return [];
		return project.getPaths().map(({ path: rojoPath, instancePath }) => ({
			path: path.resolve(this.templateDir, rojoPathTarget(rojoPath)),
			node: instancePath,
		}));
	}

	/** The template's `globIgnorePaths`, relative to the project dir. */
	get globIgnorePaths(): string[] {
		const globs = this.config.template?.project.globIgnorePaths ?? [];
		if (!this.templateFile || this.templateDir === this.layout.projectDir) {
			return globs;
		}
		return globs.map((glob) =>
			this.layout.relativeToProject(path.resolve(this.templateDir, glob))
		);
	}

	getNode(instancePath: readonly string[]): Readonly<RojoNode> | undefined {
		return this.project.getNode(instancePath);
	}

	/** The template with generated containers being what a build creates, ready to have nodes inserted. */
	edit(): RojoProject {
		return new RojoProject(this.project.getTree(), generatedContainer);
	}

	/** The node of `file` the template defines: its own, or a folder of its that the template gives a `$path`, which is that folder's whole content. `source` is the file, or the folder, that names the node. */
	displacing(file: {
		readonly entry: { readonly source: string; readonly rootDir: string };
		readonly instancePath: readonly string[];
		readonly folderNodes: readonly {
			readonly dir: string;
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
			source: folder
				? joinPosix(file.entry.rootDir, folder.dir)
				: file.entry.source,
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
