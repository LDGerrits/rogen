import path from "path";
import { compareStrings, groupBy } from "../../base/collections.js";
import { isMatch } from "../../base/glob.js";
import {
	dirnamePosix,
	joinPosix,
	samePath,
	stemOf,
	toPosix,
} from "../../base/path.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { isConfigFileName } from "../config/config.js";
import { RojoFile, RojoFileKind } from "../rojo/rojo.js";
import { ScanLeftOut } from "./build.js";
import { TreeMounts } from "./build-tree.js";

export interface ScannedFile {
	readonly kind: RojoFileKind;
	readonly sourcePath: string;
	readonly relativePath: string;
	/** The absolute POSIX source path. */
	readonly source: string;
}

export interface UnclaimedMeta {
	/** Absolute, POSIX-style. */
	readonly path: string;
	readonly hint?: string;
}

/** What a scan found under one source path. */
export interface ScannedRootParts {
	readonly sourcePath: string;
	/** False for a source path the index doesn't hold, which contributes nothing. */
	readonly exists: boolean;
	readonly entries: readonly ScannedFile[];
	readonly markers: readonly string[];
	/** `.meta.json` and `.meta.jsonc` files, `init.meta.json` included; Rojo applies them, they're never entries. */
	readonly metaFiles: readonly string[];
	/** The paths the scan left out, by absolute POSIX path. */
	readonly leftOut: ReadonlyMap<string, ScanLeftOut>;
}

/** What a scan found under one source path, and the questions it answers about it. */
export class ScannedRoot implements ScannedRootParts {
	readonly sourcePath: string;
	readonly exists: boolean;
	readonly entries: readonly ScannedFile[];
	readonly markers: readonly string[];
	readonly metaFiles: readonly string[];
	readonly leftOut: ReadonlyMap<string, ScanLeftOut>;

	constructor(
		parts: ScannedRootParts,
		private readonly index: IndexReader
	) {
		({
			sourcePath: this.sourcePath,
			exists: this.exists,
			entries: this.entries,
			markers: this.markers,
			metaFiles: this.metaFiles,
			leftOut: this.leftOut,
		} = parts);
	}

	static missing(sourcePath: string, index: IndexReader): ScannedRoot {
		return new ScannedRoot(
			{
				sourcePath,
				exists: false,
				entries: [],
				markers: [],
				metaFiles: [],
				leftOut: new Map(),
			},
			index
		);
	}

	get ignoredCount(): number {
		return this.countLeftOut("ignored");
	}

	/** The tree nodes that mount a path that exists under this source path; a node counts once, whatever case its path is spelt in. */
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

	/** Marker file names per directory, both relative to the source path; the root itself is "". */
	markersByDir(): ReadonlyMap<string, string[]> {
		return groupBy(
			this.markers,
			(marker) => dirnamePosix(marker),
			(marker) => path.posix.basename(marker)
		);
	}

	/** Meta no sibling on disk claims under Rojo's naming rule; ignored siblings still claim theirs. */
	unclaimedMeta(): UnclaimedMeta[] {
		return this.metaFiles.flatMap((metaFile) => {
			const fileName = path.posix.basename(metaFile);
			if (RojoFile.isInitMeta(fileName)) return [];
			const listing =
				this.index.getEntries(
					path.join(this.sourcePath, path.posix.dirname(metaFile))
				) ?? new Map<string, FileType>();
			const siblings = [...listing]
				.filter(([, type]) => isFileType(type))
				.map(([sibling]) => sibling);
			const name = RojoFile.metaStemOf(fileName) ?? fileName;
			if (siblings.some((file) => new RojoFile(file).metaName === name))
				return [];

			const folder = listing.get(name);
			return [
				{
					path: joinPosix(this.sourcePath, metaFile),
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
		if (isFolder) return `a folder's meta is ${name}/${RojoFile.INIT_META}`;
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

/** What one walk of a source path collects. */
interface Walk {
	readonly sourcePath: string;
	readonly entries: ScannedFile[];
	readonly markers: string[];
	readonly metaFiles: string[];
	readonly leftOut: Map<string, ScanLeftOut>;
}

/** Walks source paths in the index, leaving out what `globIgnorePaths` matches and what the tree mounts. */
export class RootScanner {
	constructor(
		private readonly index: IndexReader,
		private readonly ignored: readonly string[],
		private readonly mounts: TreeMounts,
		/** The project files the config writes, which a source path that holds them must not scan. */
		private readonly projectFiles: readonly string[]
	) {}

	scan(sourcePath: string): ScannedRoot {
		const walk: Walk = {
			sourcePath,
			entries: [],
			markers: [],
			metaFiles: [],
			leftOut: new Map(
				this.mounts
					.inside(sourcePath)
					.map(({ path: mounted, node }): [string, ScanLeftOut] => [
						toPosix(mounted),
						{ status: "mounted", node },
					])
			),
		};
		if (!this.visit(walk, sourcePath)) {
			return ScannedRoot.missing(sourcePath, this.index);
		}
		return new ScannedRoot(
			{
				sourcePath,
				exists: true,
				entries: walk.entries.sort((a, b) =>
					compareStrings(a.relativePath, b.relativePath)
				),
				markers: walk.markers.sort(),
				metaFiles: walk.metaFiles.sort(),
				leftOut: walk.leftOut,
			},
			this.index
		);
	}

	private ignoringGlob(absolutePath: string): string | undefined {
		const posixPath = toPosix(absolutePath);
		return this.ignored.find((glob) => isMatch(posixPath, glob));
	}

	/** The entries of `dir` that the tree doesn't mount, `globIgnorePaths` doesn't match and aren't a Rogen config; the rest are recorded as left out. */
	private keptEntries(
		walk: Walk,
		dir: string,
		listing: ReadonlyMap<string, FileType>
	): [string, FileType][] {
		const kept: [string, FileType][] = [];
		for (const [name, type] of listing) {
			const mount = this.mounts.at(path.join(dir, name));
			const glob =
				isFileType(type) && isConfigFileName(name)
					? name
					: isFileType(type) &&
						  this.projectFiles.some((file) =>
								samePath(path.join(dir, name), file)
						  )
						? name
						: this.ignoringGlob(path.join(dir, name));
			if (mount)
				walk.leftOut.set(joinPosix(dir, name), {
					status: "mounted",
					node: mount.node,
				});
			else if (glob)
				walk.leftOut.set(joinPosix(dir, name), {
					status: "ignored",
					pattern: glob,
				});
			else kept.push([name, type]);
		}
		// Left out before they exist too, or the first build and the one after it would write different files.
		for (const projectFile of this.projectFiles) {
			const outName = path.basename(projectFile);
			if (
				samePath(path.dirname(projectFile), dir) &&
				!listing.has(outName)
			)
				walk.leftOut.set(joinPosix(dir, outName), {
					status: "ignored",
					pattern: outName,
				});
		}
		return kept;
	}

	private visit(walk: Walk, dir: string): boolean {
		const listing = this.index.getEntries(dir);
		if (!listing) return false;

		const relativeDir = toPosix(path.relative(walk.sourcePath, dir));
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
				// A key can't contain a dot, so a file with a type (`@Foo.luau`, `.eslintrc.json`) is never a marker.
				const file = new RojoFile(name);
				const lowercased = file.lowercasedExtension;
				if (lowercased !== undefined) {
					walk.leftOut.set(joinPosix(dir, name), {
						status: "extensionCase",
						rename: lowercased,
					});
				} else if (file.isMeta) {
					walk.metaFiles.push(relativeTo(name));
				} else if (file.kind) {
					walk.entries.push({
						kind: file.kind,
						sourcePath: walk.sourcePath,
						relativePath: relativeTo(name),
						source: joinPosix(dir, name),
					});
				} else if (name.startsWith(".") || name.startsWith("@")) {
					walk.markers.push(relativeTo(name));
				}
			}
		}

		for (const subdir of subdirs) this.visit(walk, subdir);
		return true;
	}
}
