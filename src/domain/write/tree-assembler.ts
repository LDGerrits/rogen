import path from "path";
import { compareByCodePoint } from "../../base/collections.js";
import { literalGlob } from "../../base/glob.js";
import { ancestors, contains, isInside, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { isDirectoryType } from "../../platform/fs/file-system-service.js";
import { LeftOut } from "./write.js";
import { RojoFile, childrenBesideInit } from "../rojo/rojo.js";
import {
	NODE_FIELDS,
	RojoProject,
	RojoProjectFile,
} from "../rojo/rojo-project.js";
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

const fieldNamed = (instancePath: readonly string[]): string | undefined =>
	instancePath.find((name) => NODE_FIELDS.has(name));

const needsRojoIgnore = (why: LeftOut): boolean =>
	why.status !== "replaced" &&
	why.status !== "displaced" &&
	why.status !== "mounted" &&
	why.status !== "inProject";

export class TreeAssembler {
	constructor(
		private readonly placement: Placement,
		private readonly meta: PlacementMeta
	) {}

	assemble(): Result<Assembly, Diagnostic[]> {
		const { placement, meta } = this;
		const project = placement.tree.edit();
		const { collapsed, globIgnorePaths, errors } = this.merge(project);
		if (errors.length > 0) return err(errors);
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
				).of(placement.roots.flatMap(({ entries }) => entries))
			),
			meta,
			metaOutcomes: applied.value,
		});
	}

	private merge(project: RojoProject): {
		collapsed: Collapsed;
		globIgnorePaths: string[];
		errors: Diagnostic[];
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
		const { initDirs, errors } = this.insertNodes(project, collapsed);

		return {
			collapsed,
			errors,
			globIgnorePaths: [
				...new Set([
					...tree.globIgnorePaths,
					...ignored.map((source) => this.ignoreGlobOf(source)),
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
			.sort(compareByCodePoint);
	}

	private insertNodes(
		project: RojoProject,
		collapsed: Collapsed
	): { initDirs: Map<string, string>; errors: Diagnostic[] } {
		const { placement } = this;
		const { layout, files } = placement;
		const errors: Diagnostic[] = [];
		const named = (instancePath: readonly string[], resource: string) => {
			const field = fieldNamed(instancePath);
			if (field !== undefined)
				errors.push(
					errorDiagnostic(
						"tree.reservedName",
						{ resource },
						`"${instanceKey(instancePath)}" has "${field}" in its path, which Rojo reads as a node field, so it can't name an instance. Rename it.`
					)
				);
			return field !== undefined;
		};
		for (const [dir, instancePath] of collapsed.entries())
			project.insertNodeReplacingFolder(instancePath, {
				$path: layout.rojoFolderPath(dir),
			});
		const initDirs = new Map<string, string>();
		for (const file of files) {
			const { entry, instancePath } = file;
			if (collapsed.covers(entry.source)) continue;
			if (named(instancePath, entry.source)) continue;
			const dir = placement.initDirOf(file);
			if (dir !== undefined) {
				initDirs.set(dir, path.posix.basename(entry.source));
				project.insertNodeReplacingFolder(instancePath, {
					$path: layout.rojoFolderPath(dir),
				});
			} else
				project.insertNodeReplacingFolder(instancePath, {
					$path: layout.rojoPath(entry.source),
				});
		}
		for (const { folder, instancePath } of placement.emptyFolders)
			if (!collapsed.covers(folder) && !named(instancePath, folder))
				project.ensureContainer(instancePath);
		return { initDirs, errors };
	}

	private besideInit(dir: string, init: string): string[] {
		if (RojoFile.DEFAULT_PROJECTS.includes(init)) return [];
		const { placement } = this;
		return childrenBesideInit(placement.listing(dir), init, (name) =>
			RojoFile.at(path.posix.join(dir, name), placement.config.syncRules)
		)
			.map((name) => path.posix.join(dir, name))
			.filter(
				(sibling) =>
					placement.isFolder(sibling) ||
					!placement.layout.isReadOnly(sibling)
			)
			.map((sibling) => this.ignoreGlobOf(sibling));
	}

	private ignoreGlobOf(source: string): string {
		const { placement } = this;
		const { layout } = placement;
		const { optional } = placement.isFolder(source)
			? layout.rojoFolderPath(source)
			: layout.rojoPath(source);
		return literalGlob(optional);
	}

	private collapsibleDirs(
		leftOut: readonly string[],
		isReserved: (instancePath: readonly string[]) => boolean
	): Map<string, readonly string[]> {
		const placed = this.placement.files.map((file) =>
			this.placeEntry(file)
		);
		const claims = TreeAssembler.claimsOf(placed);
		const { entriesByDir, namedDirs } = TreeAssembler.dirsOf(placed);
		const mountableDirs = this.routingDirs(entriesByDir, namedDirs);
		const blocked = TreeAssembler.dirsAbove([
			...leftOut,
			...TreeAssembler.scriptsWithChildren(placed, claims),
		]);
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
				fieldNamed(instancePath) === undefined &&
				!isReserved(instancePath) &&
				claims.get(instancePath) === entries.length
			)
				collapsed.set(dir, instancePath);
		}
		return collapsed;
	}

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

	private static scriptsWithChildren(
		placed: readonly PlacedEntry[],
		claims: InstanceMap<number>
	): string[] {
		return placed
			.filter(
				({ file, rojoName }) =>
					rojoName !== undefined && claims.get(file.instancePath)! > 1
			)
			.map(({ source }) => source);
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
			placement.layout.compiled.folder === undefined && holds(dir);
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
