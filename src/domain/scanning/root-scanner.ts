import path from "path";
import { ErrorUtils } from "../../base/errors.js";
import { isMatch } from "../../base/glob.js";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	FileSystemService,
	FileType,
} from "../../platform/fs/file-system-service.js";

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
	readonly exclude: readonly string[];
	readonly configDir: string;
}

export interface ScanResult {
	readonly roots: readonly ScannedRoot[];
	readonly warnings: readonly string[];
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
	".msgpack",
	".md",
]);
const INIT_SCRIPT = /^(init|index)([.@-][a-z0-9_]+)?\./i;

function classifyFile(name: string): SourceKind | undefined {
	const lower = name.toLowerCase();
	if (lower.endsWith(".d.ts")) return undefined;

	const extension = path.extname(lower);
	if (SCRIPT_EXTENSIONS.has(extension)) return "script";
	if (MODEL_EXTENSIONS.has(extension)) return "model";
	if (DATA_EXTENSIONS.has(extension)) return "data";
	return undefined;
}

function isNotFound(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Roots are returned in `rootDirs` order, which decides clashes between them.
 * A root that doesn't exist yields an empty root and a warning.
 */
export async function scanRootDirs(
	fileSystem: FileSystemService,
	options: ScanOptions
): Promise<Result<ScanResult, Error>> {
	try {
		const scanned = await Promise.all(
			options.rootDirs.map((rootDir) =>
				scanRoot(fileSystem, rootDir, options)
			)
		);
		return ok({
			roots: scanned.map(
				(root, index) => root ?? emptyRoot(options.rootDirs[index])
			),
			warnings: options.rootDirs
				.filter((_, index) => !scanned[index])
				.map(missingRootWarning),
		});
	} catch (error) {
		return err(ErrorUtils.fromUnknown(error));
	}
}

function missingRootWarning(rootDir: string): string {
	return `The root dir "${rootDir}" does not exist, so it contributes nothing.`;
}

function emptyRoot(rootDir: string): ScannedRoot {
	return { rootDir, entries: [], markers: [], excluded: [] };
}

async function scanRoot(
	fileSystem: FileSystemService,
	rootDir: string,
	options: ScanOptions
): Promise<ScannedRoot | undefined> {
	const entries: ScannedEntry[] = [];
	const markers: string[] = [];
	const excluded: string[] = [];

	const isExcluded = (absolutePath: string) => {
		const fromConfig = toPosix(
			path.relative(options.configDir, absolutePath)
		);
		return options.exclude.some((glob) => isMatch(fromConfig, glob));
	};

	const visit = async (dir: string): Promise<boolean> => {
		let listing: [string, FileType][];
		try {
			listing = await fileSystem.readDirectory(dir);
		} catch (error) {
			if (isNotFound(error)) return false;
			throw error;
		}

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
				([name, type]) => type === FileType.File && isInitScript(name)
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
			if (type === FileType.Directory) {
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

		await Promise.all(subdirs.map(visit));
		return true;
	};

	if (!(await visit(rootDir))) return undefined;

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
