import path from "path";
import { isMatch } from "../../base/glob.js";
import { toPosix } from "../../base/path.js";
import { FileType } from "../../platform/fs/file-system-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { ScanDiagnostics } from "./scan-diagnostics.js";

export type SourceKind = "script" | "model" | "data";

export interface ScannedFile {
	readonly kind: SourceKind;
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

export interface ScannedRoot {
	readonly rootDir: string;
	readonly entries: readonly ScannedEntry[];
	readonly markers: readonly string[];
	readonly excluded: readonly string[];
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

const SCRIPT_EXTENSIONS = new Set([".luau", ".lua", ".ts", ".tsx"]);
const MODEL_EXTENSIONS = new Set([".rbxm", ".rbxmx"]);
const DATA_EXTENSIONS = new Set([
	".json",
	".toml",
	".csv",
	".txt",
	".yaml",
	".yml",
]);
// Rojo applies these to the file beside them; on their own they are not instances.
const METADATA_JSON = /\.meta\.json$/;
const INIT_SCRIPT = /^(init|index)([.@-][a-z0-9_]+)?\./i;

function classifyFile(name: string): SourceKind | undefined {
	const lower = name.toLowerCase();
	if (lower.endsWith(".d.ts") || METADATA_JSON.test(lower)) return undefined;

	const extension = path.extname(lower);
	if (SCRIPT_EXTENSIONS.has(extension)) return "script";
	if (MODEL_EXTENSIONS.has(extension)) return "model";
	if (DATA_EXTENSIONS.has(extension)) return "data";
	return undefined;
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
			].sort((a, b) =>
				a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0
			),
		],
	};
}

function emptyRoot(rootDir: string): ScannedRoot {
	return { rootDir, entries: [], markers: [], excluded: [] };
}

function scanRoot(
	index: IndexService,
	rootDir: string,
	options: ScanOptions,
	unresolvedLinks: Diagnostic[]
): ScannedRoot | undefined {
	const entries: ScannedEntry[] = [];
	const markers: string[] = [];
	const excluded: string[] = [];

	const isExcluded = (absolutePath: string) => {
		const posixPath = toPosix(absolutePath);
		return options.exclude.some((glob) => isMatch(posixPath, glob));
	};

	const visit = (dir: string): boolean => {
		const listing = index.getEntries(dir);
		if (!listing) return false;

		const relativeDir = toPosix(path.relative(rootDir, dir));
		const relativeTo = (name: string) =>
			relativeDir ? `${relativeDir}/${name}` : name;

		const kept: [string, FileType][] = [];
		for (const [name, type] of listing) {
			if (isExcluded(path.join(dir, name)))
				excluded.push(relativeTo(name));
			else kept.push([name, type]);
		}

		const initFile = kept
			.filter(
				([name, type]) => type & FileType.File && isInitScript(name)
			)
			.map(([name]) => name)
			.sort()[0];
		if (initFile && relativeDir) {
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
				unresolvedLinks.push(
					ScanDiagnostics.unresolvedLink(path.join(dir, name))
				);
			} else if (type & FileType.Directory) {
				subdirs.push(path.join(dir, name));
			} else if (name.startsWith(".")) {
				markers.push(relativeTo(name));
			} else {
				const kind = classifyFile(name);
				if (kind) {
					entries.push({
						kind,
						rootDir,
						relativePath: relativeTo(name),
					});
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
		excluded: excluded.sort(),
	};
}

function isInitScript(name: string): boolean {
	return classifyFile(name) === "script" && INIT_SCRIPT.test(name);
}

function byRelativePath(a: ScannedEntry, b: ScannedEntry): number {
	return a.relativePath < b.relativePath
		? -1
		: a.relativePath > b.relativePath
			? 1
			: 0;
}
