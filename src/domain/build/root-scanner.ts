import path from "path";
import { compareStrings, groupBy } from "../../base/collections.js";
import { isMatch } from "../../base/glob.js";
import { joinPosix, stemOf, toPosix } from "../../base/path.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { RojoFile, RojoFileKind } from "../rojo/rojo.js";
import { ScanLeftOut } from "./build.js";
import { TemplateMounts } from "./build-template.js";

export interface ScannedFile {
	readonly kind: RojoFileKind;
	readonly rootDir: string;
	readonly relativePath: string;
	/** The absolute POSIX source path. */
	readonly source: string;
}

export interface UnclaimedMeta {
	/** Absolute, POSIX-style. */
	readonly path: string;
	readonly hint?: string;
}

/** What a scan found under one root dir. */
export class ScannedRoot {
	constructor(
		readonly rootDir: string,
		/** False for a root dir the index doesn't hold, which contributes nothing. */
		readonly exists: boolean,
		readonly entries: readonly ScannedFile[],
		readonly markers: readonly string[],
		/** `.meta.json` files, `init.meta.json` included; Rojo applies them, they're never entries. */
		readonly metaFiles: readonly string[],
		/** The paths the scan left out, by absolute POSIX path. */
		readonly leftOut: ReadonlyMap<string, ScanLeftOut>,
		private readonly index: IndexReader
	) {}

	static missing(rootDir: string, index: IndexReader): ScannedRoot {
		return new ScannedRoot(rootDir, false, [], [], [], new Map(), index);
	}

	get excludedCount(): number {
		return this.countLeftOut("excluded");
	}

	/** The template nodes that mount a path that exists under this root dir; a node counts once, whatever case its path is spelt in. */
	get mountedCount(): number {
		const nodes = new Set<string>();
		for (const [mounted, why] of this.leftOut)
			if (
				why.status === "mounted" &&
				this.index.hasEntry(
					path.dirname(mounted),
					path.basename(mounted)
				)
			)
				nodes.add(why.node.join("/"));
		return nodes.size;
	}

	get skippedCount(): number {
		return this.countLeftOut("skipped");
	}

	/** What the index holds in `dir`, or nothing for a dir it doesn't hold. */
	listing(dir: string): ReadonlyMap<string, FileType> {
		return this.index.getEntries(dir) ?? new Map<string, FileType>();
	}

	/** Marker file names per directory, both relative to the root dir; the root itself is "". */
	markersByDir(): ReadonlyMap<string, string[]> {
		return groupBy(
			this.markers,
			(marker) => {
				const dir = path.posix.dirname(marker);
				return dir === "." ? "" : dir;
			},
			(marker) => path.posix.basename(marker)
		);
	}

	/** Meta no sibling on disk claims under Rojo's naming rule; pruned and excluded siblings still claim theirs. */
	unclaimedMeta(): UnclaimedMeta[] {
		return this.metaFiles.flatMap((metaFile) => {
			const fileName = path.posix.basename(metaFile);
			if (fileName === RojoFile.INIT_META) return [];
			const listing =
				this.index.getEntries(
					path.join(this.rootDir, path.posix.dirname(metaFile))
				) ?? new Map<string, FileType>();
			const siblings = [...listing]
				.filter(([, type]) => isFileType(type))
				.map(([sibling]) => sibling);
			const name = fileName.slice(0, -RojoFile.META_SUFFIX.length);
			if (siblings.some((file) => new RojoFile(file).metaName === name))
				return [];

			const folder = listing.get(name);
			return [
				{
					path: joinPosix(this.rootDir, metaFile),
					hint: ScannedRoot.hintFor(
						name,
						siblings,
						folder !== undefined && isDirectoryType(folder)
					),
				},
			];
		});
	}

	private countLeftOut(status: ScanLeftOut["status"]): number {
		return [...this.leftOut.values()].filter((why) => why.status === status)
			.length;
	}

	private static hintFor(
		name: string,
		siblings: readonly string[],
		isFolder: boolean
	): string | undefined {
		if (isFolder)
			return `a folder's meta is ${name}/init${RojoFile.META_SUFFIX}`;
		for (const file of siblings) {
			if (stemOf(file) !== name) continue;
			const metaName = new RojoFile(file).metaName;
			if (metaName)
				return `Rojo reads ${metaName}${RojoFile.META_SUFFIX}`;
		}
		const withoutMeta = siblings.find((file) => {
			const rojoFile = new RojoFile(file);
			return (
				rojoFile.metaName === undefined &&
				rojoFile.kind !== undefined &&
				[stemOf(file), rojoFile.dataName].includes(name)
			);
		});
		return withoutMeta ? `${withoutMeta} takes no meta` : undefined;
	}
}

/** What one walk of a root dir collects. */
interface Walk {
	readonly rootDir: string;
	readonly entries: ScannedFile[];
	readonly markers: string[];
	readonly metaFiles: string[];
	readonly leftOut: Map<string, ScanLeftOut>;
}

/** Walks root dirs in the index, leaving out what `exclude` matches and what the template mounts. */
export class RootScanner {
	constructor(
		private readonly index: IndexReader,
		private readonly exclude: readonly string[],
		private readonly mounts: TemplateMounts
	) {}

	scan(rootDir: string): ScannedRoot {
		const walk: Walk = {
			rootDir,
			entries: [],
			markers: [],
			metaFiles: [],
			leftOut: new Map(
				this.mounts
					.inside(rootDir)
					.map(({ path: mounted, node }): [string, ScanLeftOut] => [
						toPosix(mounted),
						{ status: "mounted", node },
					])
			),
		};
		if (!this.visit(walk, rootDir)) {
			return ScannedRoot.missing(rootDir, this.index);
		}
		return new ScannedRoot(
			rootDir,
			true,
			walk.entries.sort((a, b) =>
				compareStrings(a.relativePath, b.relativePath)
			),
			walk.markers.sort(),
			walk.metaFiles.sort(),
			walk.leftOut,
			this.index
		);
	}

	private excludingGlob(absolutePath: string): string | undefined {
		const posixPath = toPosix(absolutePath);
		return this.exclude.find((glob) => isMatch(posixPath, glob));
	}

	/** The entries of `dir` that the template doesn't mount and `exclude` doesn't match; the rest are recorded as left out. */
	private keptEntries(
		walk: Walk,
		dir: string,
		listing: ReadonlyMap<string, FileType>
	): [string, FileType][] {
		const kept: [string, FileType][] = [];
		for (const [name, type] of listing) {
			const mount = this.mounts.at(path.join(dir, name));
			const glob = this.excludingGlob(path.join(dir, name));
			if (mount)
				walk.leftOut.set(joinPosix(dir, name), {
					status: "mounted",
					node: mount.node,
				});
			else if (glob)
				walk.leftOut.set(joinPosix(dir, name), {
					status: "excluded",
					pattern: glob,
				});
			else kept.push([name, type]);
		}
		return kept;
	}

	private visit(walk: Walk, dir: string): boolean {
		const listing = this.index.getEntries(dir);
		if (!listing) return false;

		const relativeDir = toPosix(path.relative(walk.rootDir, dir));
		const relativeTo = (name: string) =>
			relativeDir ? `${relativeDir}/${name}` : name;

		const kept = this.keptEntries(walk, dir, listing);

		const subdirs: string[] = [];
		for (const [name, type] of kept) {
			if (type === FileType.SymbolicLink) {
				walk.leftOut.set(joinPosix(dir, name), { status: "skipped" });
			} else if (isDirectoryType(type)) {
				subdirs.push(path.join(dir, name));
			} else {
				// A key can't contain a dot, so a dot-file with a file type is never a marker.
				const file = new RojoFile(name);
				if (file.isMeta) {
					walk.metaFiles.push(relativeTo(name));
				} else if (file.kind) {
					walk.entries.push({
						kind: file.kind,
						rootDir: walk.rootDir,
						relativePath: relativeTo(name),
						source: joinPosix(dir, name),
					});
				} else if (name.startsWith(".")) {
					walk.markers.push(relativeTo(name));
				}
			}
		}

		for (const subdir of subdirs) this.visit(walk, subdir);
		return true;
	}
}
