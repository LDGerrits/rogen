import path from "path";
import { compareStrings } from "../../base/collections.js";
import { ancestors, contains, isInside, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	InstanceMap,
	RojoProject,
	RojoTree,
	instanceKey,
} from "../rojo/rojo-project.js";
import {
	CollapsedDirs,
	FolderMetaApplier,
	FolderMetaOutcome,
} from "./folder-meta.js";
import { BuildMeta } from "./meta-reader.js";
import { Placement } from "./placement.js";
import { rojoNameOf } from "./root-scanner.js";
import { RoutedFile } from "./router.js";

/** A placed build with its tree; what the rules report on. */
export class Assembly {
	constructor(
		readonly placement: Placement,
		readonly tree: RojoTree,
		readonly meta: BuildMeta,
		readonly metaOutcomes: readonly FolderMetaOutcome[]
	) {}
}

/** Directories written as one `$path`, mapped to the instance each becomes. */
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

/** A file placed in the tree, as the directory it sits in would name it. */
interface PlacedEntry {
	readonly file: RoutedFile;
	readonly source: string;
	readonly rojoName: string;
}

/** Turns a placed build and the meta it read into its Rojo tree. */
export class TreeAssembler {
	assemble(
		placement: Placement,
		meta: BuildMeta
	): Result<Assembly, Diagnostic[]> {
		const project = placement.template.edit();
		const { collapsed, globIgnorePaths } = this.merge(placement, project);
		const applied = new FolderMetaApplier(
			placement,
			collapsed,
			meta.folderMeta
		).apply(project);
		if (applied.isErr()) return err(applied.error);

		return ok(
			new Assembly(
				placement,
				placement.template.toFile(
					project.getTree().tree,
					globIgnorePaths
				),
				meta,
				applied.value
			)
		);
	}

	/** Merges the placed files into `project`, collapsing a directory into one `$path` where Rojo would see the same files. */
	private merge(
		{ layout, template, files, leftOut: allLeftOut }: Placement,
		project: RojoProject
	): { collapsed: Collapsed; globIgnorePaths: string[] } {
		const leftOut = [...allLeftOut].filter(
			([source]) => !layout.isReadOnly(source)
		);
		// A replaced file may share the winner's emitted path, and the template mounts a displaced or mounted one.
		const mounts = template.mounts.paths;
		// Rojo must read a mount, so a left-out folder that holds one can't be ignored either; it is never collapsed, so nothing else reads it.
		const ignored = leftOut
			.filter(
				([source, why]) =>
					!mounts.some((mount) => contains(source, mount)) &&
					why.status !== "replaced" &&
					why.status !== "displaced" &&
					why.status !== "mounted"
			)
			.map(([source]) => source)
			.sort(compareStrings);
		const collapsed = new Collapsed(
			this.collapsibleDirs(
				files,
				leftOut.map(([source]) => source),
				(instancePath) => template.getNode(instancePath) !== undefined
			)
		);

		for (const [dir, instancePath] of collapsed.entries())
			project.insertNode(instancePath, { $path: layout.syncPath(dir) });
		for (const { entry, instancePath } of files) {
			if (collapsed.covers(entry.source)) continue;
			project.insertNode(instancePath, {
				$path: layout.syncPath(entry.source),
			});
		}

		return {
			collapsed,
			globIgnorePaths: [
				...new Set([
					...template.globIgnorePaths,
					...ignored.map(
						(source) => layout.syncPath(source).optional
					),
				]),
			],
		};
	}

	/** Directories written as one `$path` because every file in them lands where Rojo would put it; only the outermost of nested ones. */
	private collapsibleDirs(
		files: readonly RoutedFile[],
		leftOut: readonly string[],
		isReserved: (instancePath: readonly string[]) => boolean
	): Map<string, readonly string[]> {
		const placed = files.map((file) => this.placeEntry(file));
		const claims = new InstanceMap<number>();
		const entriesByDir = new Map<string, PlacedEntry[]>();
		const namedDirs = new Set<string>();
		for (const entry of placed) {
			const { instancePath, folderNodes, entry: scanned } = entry.file;
			for (let length = 1; length <= instancePath.length; length++) {
				const claimed = instancePath.slice(0, length);
				claims.set(claimed, (claims.get(claimed) ?? 0) + 1);
			}

			const rootDir = toPosix(scanned.rootDir);
			for (const { dir } of folderNodes)
				namedDirs.add(path.posix.join(rootDir, dir));
			for (const dir of ancestors(entry.source)) {
				if (!isInside(dir, rootDir)) break;
				const inDir = entriesByDir.get(dir);
				if (inDir) inDir.push(entry);
				else entriesByDir.set(dir, [entry]);
			}
		}

		const blocked = new Set<string>();
		for (const source of leftOut)
			for (const dir of ancestors(source)) {
				if (blocked.has(dir)) break;
				blocked.add(dir);
			}

		const collapsed = new Map<string, readonly string[]>();
		const covering = new Collapsed(collapsed);
		const outermostFirst = [...entriesByDir].sort(
			([a], [b]) => a.split("/").length - b.split("/").length
		);
		for (const [dir, entries] of outermostFirst) {
			if (blocked.has(dir) || !namedDirs.has(dir) || covering.covers(dir))
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

	/** The instance the directory becomes, if every entry sits where Rojo would put it. Never a service itself. */
	private instancePathOf(
		dir: string,
		entries: readonly PlacedEntry[]
	): readonly string[] | undefined {
		let base: readonly string[] | undefined;
		for (const { source, rojoName, file } of entries) {
			const below = path.posix.relative(dir, source).split("/");
			const expected = [...below.slice(0, -1), rojoName];
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
		return {
			file,
			source: file.entry.source,
			rojoName: rojoNameOf(file.entry),
		};
	}
}
