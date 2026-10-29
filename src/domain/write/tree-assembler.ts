import path from "path";
import { compareStrings } from "../../base/collections.js";
import { literalGlob } from "../../base/glob.js";
import { ancestors, contains, isInside, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { isDirectoryType } from "../../platform/fs/file-system-service.js";
import { LeftOut } from "./write.js";
import { RojoFile, childrenBesideInit } from "../rojo/rojo.js";
import { RojoProject, RojoProjectFile } from "../rojo/rojo-project.js";
import {
	CollapsedDirs,
	FolderMetaApplier,
	FolderMetaOutcome,
} from "./folder-meta.js";
import { PlacementMeta } from "./meta-reader.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";
import { WrittenSyncRules } from "./written-sync-rules.js";
import { InstanceMap, instanceKey } from "../roblox/roblox.js";

export interface Assembly {
	readonly placement: Placement;
	readonly projectFile: RojoProjectFile;
	readonly meta: PlacementMeta;
	readonly metaOutcomes: readonly FolderMetaOutcome[];
}

class Collapsed implements CollapsedDirs {
	constructor(
		private readonly instances: ReadonlyMap<string, readonly string[]>
	) {}

	entries(): IterableIterator<[string, readonly string[]]> {
		return this.instances.entries();
	}

	covers(source: string): boolean {
		if (this.instances.has(source)) return true;
		for (const dir of ancestors(source))
			if (this.instances.has(dir)) return true;
		return false;
	}
}

interface PlacedEntry {
	readonly file: RoutedFile;
	readonly source: string;
	readonly rojoName: string | undefined;
}

const needsRojoIgnore = (why: LeftOut): boolean =>
	why.status !== "replaced" &&
	why.status !== "displaced" &&
	why.status !== "mounted" &&
	why.status !== "inProject";

/** Turns a placement and the meta it read into its Rojo tree. */
export class TreeAssembler {
	constructor(
		private readonly placement: Placement,
		private readonly meta: PlacementMeta
	) {}

	assemble(): Result<Assembly, Diagnostic[]> {
		const { placement, meta } = this;
		const project = placement.tree.edit();
		const { collapsed, globIgnorePaths } = this.merge(project);
		const applied = new FolderMetaApplier(
			placement,
			collapsed,
			meta.folderMeta
		).apply(project);
		if (applied.isErr()) return err(applied.error);

		return ok({
			placement,
			projectFile: placement.tree.toFile(
				project.getFile().tree,
				globIgnorePaths,
				new WrittenSyncRules(
					placement.config,
					placement.layout,
					placement.tree.globs
				).of(
					placement.roots.flatMap(({ entries }) => entries),
					new Set(
						[...placement.playerClientScripts.rulable].filter(
							(source) => meta.runContextOf(source) === undefined
						)
					)
				)
			),
			meta,
			metaOutcomes: applied.value,
		});
	}

	private merge(project: RojoProject): {
		collapsed: Collapsed;
		globIgnorePaths: string[];
	} {
		const { placement } = this;
		const { layout, tree, leftOut: allLeftOut } = placement;
		const leftOut = [...allLeftOut].filter(
			([source]) => !layout.isReadOnly(source)
		);
		const ignored = this.ignoredSources(leftOut, tree.mounts.paths);
		const collapsed = new Collapsed(
			this.collapsibleDirs(
				leftOut.map(([source]) => source),
				(instancePath) => tree.getNode(instancePath) !== undefined
			)
		);
		const initDirs = this.insertNodes(project, collapsed);

		return {
			collapsed,
			globIgnorePaths: [
				...new Set([
					...tree.globIgnorePaths,
					...ignored.map((source) =>
						literalGlob(layout.rojoPath(source).optional)
					),
					...[...initDirs].flatMap(([dir, init]) =>
						this.besideInit(dir, init)
					),
				]),
			],
		};
	}

	private ignoredSources(
		leftOut: readonly [string, LeftOut][],
		mounts: readonly string[]
	): string[] {
		return leftOut
			.filter(
				([source, why]) =>
					!mounts.some((mount) => contains(source, mount)) &&
					needsRojoIgnore(why)
			)
			.map(([source]) => source)
			.sort(compareStrings);
	}

	private insertNodes(
		project: RojoProject,
		collapsed: Collapsed
	): Map<string, string> {
		const { placement } = this;
		const { layout, nodes } = placement;
		for (const [dir, instancePath] of collapsed.entries())
			project.insertNode(instancePath, { $path: layout.rojoPath(dir) });
		const initDirs = new Map<string, string>();
		for (const file of nodes) {
			const { entry, instancePath } = file;
			if (collapsed.covers(entry.source)) continue;
			const dir = placement.initDirOf(file);
			if (dir !== undefined) {
				initDirs.set(dir, path.posix.basename(entry.source));
				project.insertNode(instancePath, {
					$path: layout.rojoPath(dir),
				});
			} else
				project.insertNode(instancePath, {
					$path: layout.rojoPath(entry.source),
				});
		}
		for (const { folder, instancePath } of placement.emptyFolders)
			if (!collapsed.covers(folder))
				project.ensureContainer(instancePath);
		return initDirs;
	}

	private besideInit(dir: string, init: string): string[] {
		if (RojoFile.DEFAULT_PROJECTS.includes(init)) return [];
		const { placement } = this;
		const { layout } = placement;
		return childrenBesideInit(placement.listing(dir), init, (name) =>
			RojoFile.at(path.posix.join(dir, name), placement.config.syncRules)
		)
			.map((name) => path.posix.join(dir, name))
			.filter((sibling) => !layout.isReadOnly(sibling))
			.map((sibling) => literalGlob(layout.rojoPath(sibling).optional));
	}

	private collapsibleDirs(
		leftOut: readonly string[],
		isReserved: (instancePath: readonly string[]) => boolean
	): Map<string, readonly string[]> {
		const placed = this.placement.nodes.map((file) =>
			this.placeEntry(file)
		);
		const claims = TreeAssembler.claimsOf(placed);
		const { entriesByDir, namedDirs } = TreeAssembler.dirsOf(placed);
		const mountableDirs = this.routingDirs(entriesByDir, namedDirs);
		const blocked = TreeAssembler.dirsAbove(leftOut);
		const holdsUnplacedFolder = this.unplacedFolderFinder(entriesByDir);

		const collapsed = new Map<string, readonly string[]>();
		const covering = new Collapsed(collapsed);
		const outermostFirst = [...entriesByDir].sort(
			([a], [b]) => a.split("/").length - b.split("/").length
		);
		for (const [dir, entries] of outermostFirst) {
			if (
				blocked.has(dir) ||
				!mountableDirs.has(dir) ||
				covering.covers(dir) ||
				holdsUnplacedFolder(dir)
			)
				continue;
			const instancePath = this.instancePathOf(dir, entries);
			if (
				instancePath &&
				!isReserved(instancePath) &&
				claims.get(instancePath) === entries.length
			)
				collapsed.set(dir, instancePath);
		}
		return collapsed;
	}

	/** The folders a node may be mounted at: those that name one, and routing folders whose own meta Rojo wouldn't read as the node's. */
	private routingDirs(
		entriesByDir: ReadonlyMap<string, readonly PlacedEntry[]>,
		namedDirs: ReadonlySet<string>
	): Set<string> {
		const { placement, meta } = this;
		const withMeta = new Set(meta.folderMeta.map(({ folder }) => folder));
		const dirs = new Set(namedDirs);
		for (const [dir, [{ file }]] of entriesByDir) {
			const sourcePath = toPosix(file.entry.sourcePath);
			if (
				!withMeta.has(dir) &&
				placement.readings.instanceless(
					sourcePath,
					path.posix.relative(sourcePath, dir)
				) === "a routing folder"
			)
				dirs.add(dir);
		}
		return dirs;
	}

	private static claimsOf(placed: readonly PlacedEntry[]) {
		const claims = new InstanceMap<number>();
		for (const { file } of placed)
			for (let length = 1; length <= file.instancePath.length; length++) {
				const claimed = file.instancePath.slice(0, length);
				claims.set(claimed, (claims.get(claimed) ?? 0) + 1);
			}
		return claims;
	}

	private static dirsOf(placed: readonly PlacedEntry[]) {
		const entriesByDir = new Map<string, PlacedEntry[]>();
		const namedDirs = new Set<string>();
		for (const entry of placed) {
			const sourcePath = toPosix(entry.file.entry.sourcePath);
			for (const { folder } of entry.file.folderNodes)
				namedDirs.add(folder);
			for (const dir of ancestors(entry.source)) {
				if (!isInside(dir, sourcePath)) break;
				const inDir = entriesByDir.get(dir);
				if (inDir) inDir.push(entry);
				else entriesByDir.set(dir, [entry]);
			}
		}
		return { entriesByDir, namedDirs };
	}

	private static dirsAbove(sources: readonly string[]): Set<string> {
		const dirs = new Set<string>();
		for (const source of sources)
			for (const dir of ancestors(source)) {
				if (dirs.has(dir)) break;
				dirs.add(dir);
			}
		return dirs;
	}

	private unplacedFolderFinder(
		placedDirs: ReadonlyMap<string, readonly PlacedEntry[]>
	): (dir: string) => boolean {
		const { placement } = this;
		const known = new Map<string, boolean>();
		const holds = (dir: string): boolean => {
			const cached = known.get(dir);
			if (cached !== undefined) return cached;
			const found = [...placement.listing(dir)].some(([name, type]) => {
				if (!isDirectoryType(type)) return false;
				const child = path.posix.join(dir, name);
				return !placedDirs.has(child) || holds(child);
			});
			known.set(dir, found);
			return found;
		};
		return (dir) =>
			placement.layout.compiledPath === undefined && holds(dir);
	}

	private instancePathOf(
		dir: string,
		entries: readonly PlacedEntry[]
	): readonly string[] | undefined {
		let base: readonly string[] | undefined;
		for (const { source, rojoName, file } of entries) {
			const below = path.posix.relative(dir, source).split("/");
			const expected = [
				...below.slice(0, -1),
				...(rojoName === undefined ? [] : [rojoName]),
			];
			const head = file.instancePath.slice(
				0,
				file.instancePath.length - expected.length
			);
			const tail = file.instancePath.slice(head.length);
			if (
				head.length < 2 ||
				tail.some((segment, index) => segment !== expected[index])
			)
				return undefined;
			if (base && instanceKey(base) !== instanceKey(head))
				return undefined;
			base = head;
		}
		return base;
	}

	private placeEntry(file: RoutedFile): PlacedEntry {
		const { placement } = this;
		const { source } = file.entry;
		return {
			file,
			source,
			rojoName:
				placement.initDirOf(file) !== undefined
					? undefined
					: file.entry.file.instanceName,
		};
	}
}
