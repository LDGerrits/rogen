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
import { RojoFile, RojoFileKind } from "../rojo/rojo-file.js";
import { ScanLeftOut } from "./build.js";
import { TemplateMount } from "./build-template.js";

export interface ScannedFile {
	readonly kind: RojoFileKind;
	readonly rootDir: string;
	readonly relativePath: string;
	/** The absolute POSIX source path. */
	readonly source: string;
}

/** A script Rojo reads as part of an init folder. */
export interface InitFolderMember {
	/** The absolute POSIX source path. */
	readonly source: string;
	/** Its instance path below the folder's; empty for the init script, which is the folder itself. */
	readonly below: readonly string[];
}

export interface ScannedInitFolder {
	readonly kind: "init-folder";
	readonly rootDir: string;
	readonly relativePath: string;
	/** The absolute POSIX path of the folder. */
	readonly source: string;
	readonly initFile: string;
	/** Every script inside the folder that isn't excluded, by source. */
	readonly members: readonly InitFolderMember[];
}

export type ScannedEntry = ScannedFile | ScannedInitFolder;

/** The name Rojo gives an entry when it lists its directory: an init folder keeps its own name. */
export function rojoNameOf(entry: ScannedEntry): string {
	const name = path.posix.basename(entry.relativePath);
	return entry.kind === "init-folder"
		? name
		: new RojoFile(name).instanceName;
}

/** The file whose name carries an entry's suffixes, and what Rojo makes of it: an init folder's script, or the file itself. */
export function namingFileOf(entry: ScannedEntry): {
	readonly fileName: string;
	readonly kind: RojoFileKind;
} {
	return entry.kind === "init-folder"
		? { fileName: entry.initFile, kind: "script" }
		: {
				fileName: path.posix.basename(entry.relativePath),
				kind: entry.kind,
			};
}

/** Every source behind an entry, each with its instance path below the entry's: an init folder's scripts, or the file itself. */
export function membersOf(entry: ScannedEntry): readonly InitFolderMember[] {
	return entry.kind === "init-folder"
		? entry.members
		: [{ source: entry.source, below: [] }];
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
		readonly entries: readonly ScannedEntry[],
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

	get skippedCount(): number {
		return this.countLeftOut("skipped");
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
	readonly entries: ScannedEntry[];
	readonly markers: string[];
	readonly metaFiles: string[];
	readonly leftOut: Map<string, ScanLeftOut>;
}

/** Walks root dirs in the index, leaving out what `exclude` matches and what the template mounts. */
export class RootScanner {
	constructor(
		private readonly index: IndexReader,
		private readonly exclude: readonly string[],
		private readonly mounts: readonly TemplateMount[] = []
	) {}

	scan(rootDir: string): ScannedRoot {
		const walk: Walk = {
			rootDir,
			entries: [],
			markers: [],
			metaFiles: [],
			leftOut: new Map(),
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

	private mountAt(absolutePath: string): TemplateMount | undefined {
		const resolved = path.resolve(absolutePath);
		return this.mounts.find((mount) => mount.path === resolved);
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
			const mount = this.mountAt(path.join(dir, name));
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

		const initFile = kept
			.filter(
				([name, type]) =>
					isFileType(type) && new RojoFile(name).isInitScript
			)
			.map(([name]) => name)
			.sort()[0];
		if (initFile && relativeDir) {
			if (kept.some(([name]) => name === RojoFile.INIT_META))
				walk.metaFiles.push(relativeTo(RojoFile.INIT_META));
			walk.entries.push({
				kind: "init-folder",
				rootDir: walk.rootDir,
				relativePath: relativeDir,
				source: joinPosix(walk.rootDir, relativeDir),
				initFile,
				members: this.initFolderMembers(walk, dir, kept),
			});
			return true;
		}

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

	/** Rojo reads everything in an init folder as children of the folder's instance, and its init script as the folder itself. */
	private initFolderMembers(
		walk: Walk,
		folder: string,
		kept: readonly [string, FileType][]
	): InitFolderMember[] {
		const members: InitFolderMember[] = [];
		const visit = (
			dir: string,
			entries: readonly [string, FileType][],
			below: readonly string[]
		) => {
			for (const [name, type] of [...entries].sort(([a], [b]) =>
				compareStrings(a, b)
			)) {
				const entryPath = path.join(dir, name);
				if (isDirectoryType(type)) {
					const listing = this.index.getEntries(entryPath);
					if (listing)
						visit(
							entryPath,
							this.keptEntries(walk, entryPath, listing),
							[...below, name]
						);
					continue;
				}
				const file = new RojoFile(name);
				if (!isFileType(type) || !file.kind) continue;
				members.push({
					source: joinPosix(dir, name),
					below: file.isInitScript
						? below
						: [...below, file.instanceName],
				});
			}
		};
		visit(folder, kept, []);
		return members;
	}
}
