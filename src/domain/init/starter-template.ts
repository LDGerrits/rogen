import { formatJsonFile } from "../../base/json.js";
import { containsPosix, normalizeDir } from "../../base/path.js";
import {
	MountedPath,
	ParsedProjectFile,
	ProjectFile,
	RojoNode,
	RojoProject,
	instanceKey,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { Mount } from "../toolchain/toolchain.js";

export type TemplateChoice =
	/** Start `template.project.json` from the package mounts, when there are any. */
	| { readonly kind: "new" }
	/** Copy a hand-written project file to `template.project.json`. */
	| { readonly kind: "copy"; readonly from: string }
	/** Reference a hand-written project file as it is. */
	| { readonly kind: "use"; readonly file: string };

const mountNode = ({ path, optional }: Mount): Partial<RojoNode> => ({
	$path: optional ? { optional: path } : path,
});

const describe = ({ path, instancePath }: MountedPath): string =>
	`${normalizeDir(rojoPathTarget(path))} at ${instanceKey(instancePath)}`;

/** The project file `init` starts for a config: what it mounts, and what a copy of a hand-written one leaves out or gains. */
export class StarterTemplate {
	private constructor(
		private readonly project: RojoProject<ParsedProjectFile>
	) {}

	/** A template for `name` that mounts `mounts`, each at its landing; `undefined` when there is nothing to mount. */
	static fromMounts(
		name: string,
		mounts: readonly Mount[]
	): StarterTemplate | undefined {
		if (mounts.length === 0) return undefined;
		const project = new RojoProject<ParsedProjectFile>({
			name,
			tree: { $className: "DataModel" },
		});
		for (const mount of mounts)
			project.insertNode(mount.landing.split("/"), mountNode(mount));
		return new StarterTemplate(project);
	}

	/** `undefined` when `text` isn't a project file. */
	static parse(text: string): StarterTemplate | undefined {
		const project = RojoProject.parse(text);
		return project.isOk() ? new StarterTemplate(project.value) : undefined;
	}

	/** This template without the nodes that point into `dirs`, and where they were; `undefined` when a dir is the whole folder. */
	withoutNodesIn(
		dirs: readonly string[]
	): { template: StarterTemplate; removed: string[] } | undefined {
		const claimed = dirs.map(normalizeDir);
		if (claimed.includes(".")) return undefined;

		const edited = this.copy();
		const removed = edited.removeNodes((target) =>
			claimed.some((dir) => containsPosix(dir, normalizeDir(target)))
		);
		return {
			template: new StarterTemplate(edited),
			removed: removed.map((instancePath) => instanceKey(instancePath)),
		};
	}

	/** This template plus the `mounts` it lacks, as `<path> at <node>`; a node already there wins and its mounts are `skipped`. */
	withMounts(mounts: readonly Mount[]): {
		template: StarterTemplate;
		added: string[];
		skipped: string[];
	} {
		const mounted = this.project
			.getPaths()
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
			template: new StarterTemplate(edited),
			added: added.map(describe),
			skipped: skipped.map(describe),
		};
	}

	toJson(): string {
		return formatJsonFile(this.project.getTree());
	}

	private copy(): RojoProject<ParsedProjectFile> {
		return new RojoProject(this.project.getTree());
	}
}
