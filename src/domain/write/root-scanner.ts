import path from "path";
import { compareStrings, groupBy } from "../../base/collections.js";
import { ignoringGlob } from "../../base/glob.js";
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
import { isConfigFileName, isSyncbackFileName } from "../config/config.js";
import { RojoFile, RojoFileKind } from "../rojo/rojo.js";
import { ScanLeftOut } from "./write.js";
import { TreeMounts } from "./write-tree.js";
import { PortableName } from "./portable-name.js";

export interface ScannedFile {
	readonly kind: RojoFileKind;
	/** The file as Rojo reads it with the project's sync rules, read once for the whole write. */
	readonly file: RojoFile;
	readonly sourcePath: string;
	readonly relativePath: string;
	/** The absolute POSIX source path. */
	readonly source: string;
}

/** The file at an absolute POSIX path, read as Rojo reads it. */
export type FileAt = (source: string) => RojoFile;

export interface UnclaimedMeta {
	/** Absolute, POSIX-style. */
	readonly path: string;
	readonly hint?: string;
}

/** A file or folder whose name does not hold on every system; a backslash makes Rogen leave it out. */
export interface OddName {
	/** The absolute POSIX path, with the name as it is on disk. */
	readonly source: string;
	readonly reason: string;
	readonly leftOut: boolean;
}

interface ScannedRootParts {
	readonly sourcePath: string;
	/** False for a source path the index doesn't hold, which contributes nothing. */
	readonly exists: boolean;
	readonly entries: readonly ScannedFile[];
	readonly markers: readonly string[];
	/** `.meta.json` and `.meta.jsonc` files, `init.meta.json` included; they are never entries. */
	readonly metaFiles: readonly string[];
	/** The meta files that `globIgnorePaths` matches, which Rojo still applies; one that no file claims is not reported. */
	readonly ignoredMeta: readonly string[];
	/** The folders below the source path that hold no file or folder Rojo makes an instance from, relative to it; Rojo builds each as an empty Folder. */
	readonly emptyDirs: readonly string[];
	/** The paths the scan left out, by absolute POSIX path. */
	readonly leftOut: ReadonlyMap<string, ScanLeftOut>;
	readonly oddNames: readonly OddName[];
}

/** What a scan found under one source path, and the questions it answers about it. */
export class ScannedRoot implements ScannedRootParts {
	readonly sourcePath: string;
	readonly exists: boolean;
	readonly entries: readonly ScannedFile[];
	readonly markers: readonly string[];
	readonly metaFiles: readonly string[];
	readonly ignoredMeta: readonly string[];
	readonly emptyDirs: readonly string[];
	readonly leftOut: ReadonlyMap<string, ScanLeftOut>;
	readonly oddNames: readonly OddName[];

	constructor(
		parts: ScannedRootParts,
		private readonly index: IndexReader,
		private readonly fileAt: FileAt
	) {
		({
			sourcePath: this.sourcePath,
			exists: this.exists,
			entries: this.entries,
			markers: this.markers,
			metaFiles: this.metaFiles,
			ignoredMeta: this.ignoredMeta,
			emptyDirs: this.emptyDirs,
			leftOut: this.leftOut,
			oddNames: this.oddNames,
		} = parts);
	}

	static missing(
		sourcePath: string,
		index: IndexReader,
		fileAt: FileAt
	): ScannedRoot {
		return new ScannedRoot(
			{
				sourcePath,
				exists: false,
				entries: [],
				markers: [],
				metaFiles: [],
				ignoredMeta: [],
				emptyDirs: [],
				leftOut: new Map(),
				oddNames: [],
			},
			index,
			fileAt
		);
	}

	get ignoredCount(): number {
		return this.countLeftOut("ignored");
	}

	/** The tree nodes that mount a path under this source path; a node counts once. */
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
			if (
				RojoFile.isInitMeta(fileName) ||
				this.ignoredMeta.includes(metaFile)
			)
				return [];
			const dir = path.join(
				this.sourcePath,
				path.posix.dirname(metaFile)
			);
			const listing =
				this.index.getEntries(dir) ?? new Map<string, FileType>();
			const siblings = [...listing]
				.filter(([, type]) => isFileType(type))
				.map(([sibling]) => this.fileAt(joinPosix(dir, sibling)));
			const name = RojoFile.metaStemOf(fileName) ?? fileName;
			if (siblings.some((file) => file.metaName === name)) return [];

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
		siblings: readonly RojoFile[],
		isFolder: boolean
	): string | undefined {
		if (isFolder) return `a folder's meta is ${name}/${RojoFile.INIT_META}`;
		for (const file of siblings) {
			if (stemOf(file.name) !== name) continue;
			if (file.metaName)
				return `Rojo reads ${file.metaName}${RojoFile.META_SUFFIX}`;
		}
		const withoutMeta = siblings.find(
			(file) =>
				file.metaName === undefined &&
				file.kind !== undefined &&
				[stemOf(file.name), file.dataName].includes(name)
		);
		return withoutMeta ? `${withoutMeta.name} takes no meta` : undefined;
	}
}

interface Walk {
	readonly sourcePath: string;
	readonly entries: ScannedFile[];
	readonly markers: string[];
	readonly metaFiles: string[];
	readonly ignoredMeta: string[];
	readonly emptyDirs: string[];
	readonly leftOut: Map<string, ScanLeftOut>;
	readonly oddNames: OddName[];
}

/** Walks source paths in the index, leaving out what `globIgnorePaths` matches and what the tree mounts. */
export class RootScanner {
	constructor(
		private readonly index: IndexReader,
		private readonly ignored: readonly string[],
		private readonly mounts: TreeMounts,
		private readonly projectFiles: readonly string[],
		private readonly fileAt: FileAt
	) {}

	scan(sourcePath: string): ScannedRoot {
		const walk: Walk = {
			sourcePath,
			entries: [],
			markers: [],
			metaFiles: [],
			ignoredMeta: [],
			emptyDirs: [],
			oddNames: [],
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
			return ScannedRoot.missing(sourcePath, this.index, this.fileAt);
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
				ignoredMeta: walk.ignoredMeta.sort(),
				emptyDirs: walk.emptyDirs.sort(),
				leftOut: walk.leftOut,
				oddNames: walk.oddNames.sort((a, b) =>
					compareStrings(a.source, b.source)
				),
			},
			this.index,
			this.fileAt
		);
	}

	private ignoringGlob(absolutePath: string): string | undefined {
		return ignoringGlob(toPosix(absolutePath), this.ignored);
	}

	private keptEntries(
		walk: Walk,
		dir: string,
		listing: ReadonlyMap<string, FileType>
	): [string, FileType][] {
		const kept: [string, FileType][] = [];
		for (const [name, type] of listing) {
			const mount = this.mounts.at(path.join(dir, name));
			// Rojo applies a meta file that globIgnorePaths matches.
			const meta =
				isFileType(type) && this.fileAt(joinPosix(dir, name)).isMeta;
			if (meta && this.ignoringGlob(path.join(dir, name)))
				walk.ignoredMeta.push(
					toPosix(
						path.relative(walk.sourcePath, path.join(dir, name))
					)
				);
			const glob = meta
				? undefined
				: (isFileType(type) && isConfigFileName(name)) ||
					  isSyncbackFileName(name)
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

	/** Takes a folder that holds a default project file as that project alone, as Rojo reads it; false when it holds none. */
	private visitProject(
		walk: Walk,
		dir: string,
		kept: readonly [string, FileType][]
	): boolean {
		const names = new Set(
			kept.flatMap(([name, type]) => (isFileType(type) ? [name] : []))
		);
		const name = RojoFile.DEFAULT_PROJECTS.find((each) => names.has(each));
		if (name === undefined) return false;
		const project = joinPosix(dir, name);
		const file = this.fileAt(project);
		walk.entries.push({
			kind: file.kind ?? "data",
			file,
			sourcePath: walk.sourcePath,
			relativePath: toPosix(
				path.relative(walk.sourcePath, path.join(dir, name))
			),
			source: project,
		});
		for (const [other] of kept)
			if (other !== name)
				walk.leftOut.set(joinPosix(dir, other), {
					status: "inProject",
					project,
				});
		return true;
	}

	private visit(walk: Walk, dir: string): boolean {
		const listing = this.index.getEntries(dir);
		if (!listing) return false;

		const relativeDir = toPosix(path.relative(walk.sourcePath, dir));
		const relativeTo = (name: string) =>
			relativeDir ? `${relativeDir}/${name}` : name;

		const kept = this.keptEntries(walk, dir, listing);
		if (dir !== walk.sourcePath && this.visitProject(walk, dir, kept))
			return true;

		const odd = (name: string, reason: string, leftOut = false) =>
			walk.oddNames.push({
				source: `${toPosix(dir)}/${name}`,
				reason,
				leftOut,
			});
		const instanceNames: string[] = [];

		const subdirs: string[] = [];
		for (const [name, type] of kept) {
			if (name.includes("\\")) {
				if (
					isDirectoryType(type) ||
					this.fileAt(joinPosix(dir, name)).kind
				)
					odd(name, PortableName.problemWith(name, name) ?? "", true);
			} else if (type === FileType.SymbolicLink) {
				walk.leftOut.set(joinPosix(dir, name), { status: "skipped" });
			} else if (isDirectoryType(type)) {
				subdirs.push(path.join(dir, name));
				instanceNames.push(name);
				const problem = PortableName.problemWith(name, name);
				if (problem) odd(name, problem);
			} else {
				const file = this.fileAt(joinPosix(dir, name));
				const lowercased = file.lowercasedExtension;
				if (file.ignoredBy) {
					walk.leftOut.set(joinPosix(dir, name), {
						status: "ignored",
						pattern: file.ignoredBy.pattern,
					});
				} else if (lowercased !== undefined) {
					walk.leftOut.set(joinPosix(dir, name), {
						status: "extensionCase",
						rename: lowercased,
					});
				} else if (file.isMeta) {
					walk.metaFiles.push(relativeTo(name));
					const problem = PortableName.problemWith(name, name);
					if (problem) odd(name, problem);
				} else if (file.kind) {
					const problem = PortableName.problemWith(
						name,
						stemOf(name)
					);
					if (problem) odd(name, problem);
					instanceNames.push(name);
					walk.entries.push({
						kind: file.kind,
						file,
						sourcePath: walk.sourcePath,
						relativePath: relativeTo(name),
						source: joinPosix(dir, name),
					});
				} else if (name.startsWith(".") || name.startsWith("@")) {
					walk.markers.push(relativeTo(name));
					const problem = PortableName.problemWith(name, name);
					if (problem) odd(name, problem);
				}
			}
		}

		if (
			dir !== walk.sourcePath &&
			instanceNames.length === 0 &&
			![...listing.keys()].some((name) =>
				this.mounts.at(path.join(dir, name))
			)
		)
			walk.emptyDirs.push(relativeDir);

		const byLowercase = groupBy(instanceNames, (name) =>
			name.toLowerCase()
		);
		for (const names of byLowercase.values())
			if (names.length > 1)
				for (const name of names)
					odd(
						name,
						`differs from ${names.filter((other) => other !== name).join(", ")} only in letter case, so they cannot sit in one folder on Windows or macOS`
					);

		for (const subdir of subdirs) this.visit(walk, subdir);
		return true;
	}
}
