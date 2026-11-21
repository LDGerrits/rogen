import { compareStrings, groupBy } from "../../base/collections.js";
import { joinPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { RojoMeta, RojoMetaFields } from "../rojo/rojo.js";
import { RojoNode, RojoProject } from "../rojo/rojo-project.js";
import { InstancelessFolder } from "./name-readings.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";
import { InstanceMap, instanceKey } from "../roblox/roblox.js";

export class FolderMeta {
	constructor(
		readonly file: string,
		readonly sourcePath: string,
		readonly dir: string,
		readonly fields: RojoMetaFields,
		private readonly merged: readonly string[] = []
	) {}

	get files(): string[] {
		return [this.file, ...this.merged];
	}

	get folder(): string {
		return joinPosix(this.sourcePath, this.dir);
	}
}

type Copy = Extract<FolderMetaOutcome, { kind: "copied" }>;

export interface CollapsedDirs {
	covers(path: string): boolean;
}

export type FolderMetaOutcome =
	| {
			readonly kind: "copied";
			readonly instancePath: readonly string[];
			readonly meta: FolderMeta;
			readonly treeNode: RojoNode;
	  }
	| {
			readonly kind: "shared";
			readonly instance: string;
			readonly metas: readonly FolderMeta[];
			readonly file: RoutedFile;
	  }
	| {
			readonly kind: "treePath";
			readonly instance: string;
			readonly meta: FolderMeta;
	  }
	| {
			readonly kind: "appliesToNothing";
			readonly meta: FolderMeta;
			readonly folder: InstancelessFolder;
	  };

interface ReachedNode {
	readonly instancePath: readonly string[];
	readonly dirs: Set<string>;
}

export class FolderMetaApplier {
	private readonly metaByDir: ReadonlyMap<string, FolderMeta>;

	constructor(
		private readonly placement: Placement,
		private readonly collapsed: CollapsedDirs,
		folderMeta: readonly FolderMeta[]
	) {
		this.metaByDir = new Map(folderMeta.map((meta) => [meta.folder, meta]));
	}

	apply(project: RojoProject): Result<FolderMetaOutcome[], Diagnostic[]> {
		const problems = new DiagnosticCollector();
		const outcomes = [
			...this.decide(project, problems),
			...this.instanceless(),
		];
		this.checkIds(outcomes, problems);
		if (problems.hasErrors) return err([...problems.diagnostics]);

		for (const { instancePath, meta, treeNode } of this.copies(outcomes))
			project.insertNodeReplacingFolder(
				instancePath,
				RojoMeta.fieldsUnder(meta.fields, treeNode)
			);
		return ok(outcomes);
	}

	private decide(
		project: RojoProject,
		problems: DiagnosticCollector
	): FolderMetaOutcome[] {
		const { tree, files, displaced, emptyFolders } = this.placement;
		const sharedWithFile = new InstanceMap<RoutedFile>();
		for (const file of files) sharedWithFile.set(file.instancePath, file);

		const outcomes: FolderMetaOutcome[] = [];
		const reportedClashes = new Set<string>();
		for (const [nodePath, node] of this.reachedNodes([
			...files,
			...displaced.map(({ file }) => file),
			...emptyFolders,
		])) {
			const instance = instanceKey(nodePath);
			const shared = sharedWithFile.get(nodePath);
			const ownDir = shared?.init?.becomes;
			const reached = this.metasReaching(node);
			if (reached.length === 0) continue;
			this.reportSameRootClashes(
				reached,
				instance,
				reportedClashes,
				problems
			);

			const others = shared
				? reached.filter(({ folder }) => folder !== ownDir)
				: [];
			if (shared && others.length > 0)
				outcomes.push({
					kind: "shared",
					instance,
					metas: others,
					file: shared,
				});
			const initDir = shared && this.placement.initDirOf(shared);
			const metas = shared
				? reached.filter(
						({ folder }) => folder === ownDir && folder !== initDir
					)
				: reached;
			if (metas.length === 0) continue;

			const meta = metas[metas.length - 1];
			const treeNode = tree.getNode(node.instancePath);
			if (treeNode?.$path !== undefined)
				outcomes.push({ kind: "treePath", instance, meta });
			else if (project.getNode(node.instancePath))
				outcomes.push({
					kind: "copied",
					instancePath: node.instancePath,
					meta,
					treeNode: treeNode ?? {},
				});
		}
		return outcomes;
	}

	private metasReaching(node: ReachedNode): FolderMeta[] {
		const { sourcePaths } = this.placement.config;
		return [...node.dirs]
			.filter((dir) => !this.collapsed.covers(dir))
			.flatMap((dir) => this.metaByDir.get(dir) ?? [])
			.sort(
				(a, b) =>
					sourcePaths.indexOf(a.sourcePath) -
					sourcePaths.indexOf(b.sourcePath)
			);
	}

	private reportSameRootClashes(
		reached: readonly FolderMeta[],
		instance: string,
		reported: Set<string>,
		problems: DiagnosticCollector
	): void {
		for (const clash of this.sameRootClashes(reached)) {
			const key = clash.map(({ file }) => file).join("\0");
			if (reported.has(key)) continue;
			reported.add(key);
			problems.error(
				"meta.sameNode",
				{ resource: clash[0].file },
				`${clash.map(({ file }) => file).join(" and ")} both apply to "${instance}" from one source path, and neither ranks above the other. Keep one of them.`
			);
		}
	}

	private instanceless(): FolderMetaOutcome[] {
		const { readings, routed, emptyFolders } = this.placement;
		const named = new Set(
			[...routed, ...emptyFolders].flatMap(({ folderNodes }) =>
				folderNodes.map(({ folder }) => folder)
			)
		);
		const initDirs = new Set(
			routed.flatMap((file) => this.placement.initDirOf(file) ?? [])
		);
		const folderOf = ({
			sourcePath,
			dir,
		}: FolderMeta): InstancelessFolder | undefined => {
			const folder = joinPosix(sourcePath, dir);
			return dir !== "" && (named.has(folder) || initDirs.has(folder))
				? undefined
				: readings.instanceless(sourcePath, dir);
		};
		return [...this.metaByDir.values()].flatMap((meta) => {
			const folder = folderOf(meta);
			return folder ? [{ kind: "appliesToNothing", meta, folder }] : [];
		});
	}

	private copies(outcomes: readonly FolderMetaOutcome[]): Copy[] {
		return outcomes.filter(
			(outcome): outcome is Copy => outcome.kind === "copied"
		);
	}

	private checkIds(
		outcomes: readonly FolderMetaOutcome[],
		problems: DiagnosticCollector
	): void {
		const withId = groupBy(
			this.copies(outcomes).filter(
				({ meta, treeNode }) =>
					meta.fields.id !== undefined && treeNode.$id === undefined
			),
			({ meta }) => meta,
			({ instancePath }) => instanceKey(instancePath)
		);
		for (const [meta, instances] of withId)
			if (instances.length > 1)
				problems.error(
					"meta.idOnSeveralNodes",
					{ resource: meta.file },
					`id "${meta.fields.id}" would be copied onto ${instances.length} instances (${instances.join(", ")}), but a ref must be unique. Remove the id, or keep the folder's files in one service.`
				);
	}

	private reachedNodes(
		placed: readonly Pick<RoutedFile, "folderNodes">[]
	): InstanceMap<ReachedNode> {
		const reached = new InstanceMap<ReachedNode>();
		for (const { folderNodes } of placed) {
			for (const { instancePath, folder } of folderNodes) {
				const node = reached.get(instancePath) ?? {
					instancePath,
					dirs: new Set(),
				};
				node.dirs.add(folder);
				reached.set(instancePath, node);
			}
		}
		return reached;
	}

	private sameRootClashes(metas: readonly FolderMeta[]): FolderMeta[][] {
		return [...groupBy(metas, ({ sourcePath }) => sourcePath).values()]
			.filter((group) => group.length > 1)
			.map((group) =>
				group.sort((a, b) => compareStrings(a.file, b.file))
			);
	}
}
