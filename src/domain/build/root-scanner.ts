import path from "path";
import { compareStrings } from "../../base/collection.js";
import { isMatch } from "../../base/glob.js";
import { joinPosix, toPosix } from "../../base/path.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { IndexService } from "../../platform/fs/index-service.js";
import {
	INIT_META_FILE,
	RojoFileKind,
	classifyFile,
	isInitScript,
	isMetaFile,
} from "../rojo/rojo-files.js";
import { ScanDiagnostics } from "./scan-diagnostics.js";

export interface ScannedFile {
	readonly kind: RojoFileKind;
	readonly rootDir: string;
	readonly relativePath: string;
}

export interface ScannedInitFolder {
	readonly kind: "init-folder";
	readonly rootDir: string;
	readonly relativePath: string;
	readonly initFile: string;
}

export type ScannedEntry = ScannedFile | ScannedInitFolder;

/** The entry's absolute POSIX source path; an init folder's is the folder. */
export function sourceOf({ rootDir, relativePath }: ScannedEntry): string {
	return joinPosix(rootDir, relativePath);
}

export interface ScannedRoot {
	readonly rootDir: string;
	readonly entries: readonly ScannedEntry[];
	readonly markers: readonly string[];
	/** `.meta.json` files, `init.meta.json` included; Rojo applies them, they're never entries. */
	readonly metaFiles: readonly string[];
	readonly excluded: readonly string[];
	/** The glob that excluded each path in `excluded`. */
	readonly excludedBy: ReadonlyMap<string, string>;
	/** Links that loop back to an ancestor or point at nothing, which Rojo must never walk. */
	readonly skippedLinks: readonly string[];
}

export interface ScanOptions {
	readonly rootDirs: readonly string[];
	/** Absolute, POSIX-style globs, as the collapsed config produces them. */
	readonly exclude: readonly string[];
}

export interface ScanResult {
	readonly roots: readonly ScannedRoot[];
	readonly warnings: readonly Diagnostic[];
}

/**
 * Reads only the index, which the caller has initialized with every root dir.
 * Roots come back in `rootDirs` order, which decides clashes between them.
 * A root that isn't in the index yields an empty root and a warning.
 */
export function scanRootDirs(
	index: IndexService,
	options: ScanOptions
): ScanResult {
	const unresolvedLinks: Diagnostic[] = [];
	const scanned = options.rootDirs.map((rootDir) =>
		scanRoot(index, rootDir, options, unresolvedLinks)
	);
	return {
		roots: scanned.map(
			(root, position) => root ?? emptyRoot(options.rootDirs[position])
		),
		warnings: [
			...options.rootDirs
				.filter((_, position) => !scanned[position])
				.map(ScanDiagnostics.missingRootDir),
			...[
				...new Map(
					unresolvedLinks.map((link) => [link.resource, link])
				).values(),
			].sort((a, b) => compareStrings(a.resource, b.resource)),
		],
	};
}

function emptyRoot(rootDir: string): ScannedRoot {
	return {
		rootDir,
		entries: [],
		markers: [],
		metaFiles: [],
		excluded: [],
		excludedBy: new Map(),
		skippedLinks: [],
	};
}

function scanRoot(
	index: IndexService,
	rootDir: string,
	options: ScanOptions,
	unresolvedLinks: Diagnostic[]
): ScannedRoot | undefined {
	const entries: ScannedEntry[] = [];
	const markers: string[] = [];
	const metaFiles: string[] = [];
	const excludedBy = new Map<string, string>();
	const skippedLinks: string[] = [];

	const excludingGlob = (absolutePath: string) => {
		const posixPath = toPosix(absolutePath);
		return options.exclude.find((glob) => isMatch(posixPath, glob));
	};

	const visit = (dir: string): boolean => {
		const listing = index.getEntries(dir);
		if (!listing) return false;

		const relativeDir = toPosix(path.relative(rootDir, dir));
		const relativeTo = (name: string) =>
			relativeDir ? `${relativeDir}/${name}` : name;

		const kept: [string, FileType][] = [];
		for (const [name, type] of listing) {
			const glob = excludingGlob(path.join(dir, name));
			if (glob) excludedBy.set(relativeTo(name), glob);
			else kept.push([name, type]);
		}

		const initFile = kept
			.filter(([name, type]) => isFileType(type) && isInitScript(name))
			.map(([name]) => name)
			.sort()[0];
		if (initFile && relativeDir) {
			if (kept.some(([name]) => name === INIT_META_FILE))
				metaFiles.push(relativeTo(INIT_META_FILE));
			entries.push({
				kind: "init-folder",
				rootDir,
				relativePath: relativeDir,
				initFile,
			});
			return true;
		}

		const subdirs: string[] = [];
		for (const [name, type] of kept) {
			if (type === FileType.SymbolicLink) {
				skippedLinks.push(relativeTo(name));
				unresolvedLinks.push(
					ScanDiagnostics.unresolvedLink(path.join(dir, name))
				);
			} else if (isDirectoryType(type)) {
				subdirs.push(path.join(dir, name));
			} else {
				// A key can't contain a dot, so a dot-file with a file type is never a marker.
				const kind = classifyFile(name);
				if (isMetaFile(name)) {
					metaFiles.push(relativeTo(name));
				} else if (kind) {
					entries.push({
						kind,
						rootDir,
						relativePath: relativeTo(name),
					});
				} else if (name.startsWith(".")) {
					markers.push(relativeTo(name));
				}
			}
		}

		subdirs.forEach(visit);
		return true;
	};

	if (!visit(rootDir)) return undefined;

	return {
		rootDir,
		entries: entries.sort(byRelativePath),
		markers: markers.sort(),
		metaFiles: metaFiles.sort(),
		excluded: [...excludedBy.keys()].sort(),
		excludedBy,
		skippedLinks: skippedLinks.sort(),
	};
}

function byRelativePath(a: ScannedEntry, b: ScannedEntry): number {
	return a.relativePath < b.relativePath
		? -1
		: a.relativePath > b.relativePath
			? 1
			: 0;
}
