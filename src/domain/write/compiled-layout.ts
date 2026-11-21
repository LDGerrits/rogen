import path from "path";
import { contains, containsPosix, samePath, toPosix } from "../../base/path.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	ResolvedConfig,
	compiledPathOf,
	scannedFileOf,
} from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";
import {
	OptionalRojoPath,
	RojoProject,
	RojoProjectFile,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { SyncRules } from "../rojo/sync-rules.js";
import {
	DataReplacement,
	MetaReplacement,
	SyncTool,
} from "../toolchain/toolchain.js";

/**
 * Rojo never watches a `$path` missing at load, so the write makes a folder or
 * script there first.
 */
export interface Placeholder {
	readonly path: string;
	readonly kind: "folder" | "script";
}

export const PLACEHOLDER_SOURCE =
	"-- Rogen wrote this so Rojo watches it. Your compiler replaces it.\n";

export type PlaceholderState = "absent" | "folder" | "placeholder" | "written";

export function isPlaceholder(content: string): boolean {
	return content === PLACEHOLDER_SOURCE;
}

export async function placeholderState(
	reader: FileReader,
	target: string
): Promise<PlaceholderState> {
	if (await reader.isDirectory(target)) return "folder";
	if (await reader.isFile(target))
		return isPlaceholder(await reader.readFile(target))
			? "placeholder"
			: "written";
	return (await reader.exists(target)) ? "written" : "absent";
}

export class CompiledLayout {
	readonly commonRoot: string;
	readonly compiledPath: string | undefined;
	readonly projectDir: string;
	readonly syncRules: SyncRules;

	constructor(
		config: Pick<
			ResolvedConfig,
			"commonRoot" | "compiledPath" | "projectDir" | "syncRules"
		>,
		private readonly tools: readonly SyncTool[]
	) {
		this.commonRoot = config.commonRoot ?? config.projectDir;
		this.compiledPath = config.compiledPath;
		this.projectDir = config.projectDir;
		this.syncRules = config.syncRules;
	}

	get initNames(): ReadonlySet<string> {
		return new Set([
			RojoFile.INIT_NAME,
			...this.tools.flatMap(({ initName }) => initName ?? []),
		]);
	}

	get metaReplacements(): MetaReplacement[] {
		return this.tools.flatMap(
			({ metaReplacement }) => metaReplacement ?? []
		);
	}

	get dataReplacements(): DataReplacement[] {
		return this.tools.flatMap(
			({ dataReplacement }) => dataReplacement ?? []
		);
	}

	relativeToProject(absolutePath: string): string {
		return toPosix(path.relative(this.projectDir, absolutePath));
	}

	emittedPath(filePath: string): string {
		if (this.compiledPath === undefined) return filePath;
		const compiled = compiledPathOf(this, filePath);
		if (scannedFileOf(this, toPosix(filePath)).isCompiled)
			return `${compiled.slice(0, compiled.length - path.extname(compiled).length)}.luau`;
		return this.tools.reduce(
			(emitted, tool) => tool.emittedPath?.(emitted) ?? emitted,
			compiled
		);
	}

	private compiledFolderOf(dir: string): string {
		return this.relativeToProject(compiledPathOf(this, dir));
	}

	syncedGlob(glob: string): string {
		if (this.compiledPath === undefined) return glob;
		const root = toPosix(this.commonRoot);
		const dir = toPosix(this.projectDir);
		const absolute = path.posix.join(dir, glob);
		if (!containsPosix(root, absolute)) return glob;
		return path.posix.relative(
			dir,
			path.posix.join(
				toPosix(this.compiledPath),
				path.posix.relative(root, absolute)
			)
		);
	}

	isCacheFile(file: string): boolean {
		if (this.compiledPath === undefined) return false;
		if (!samePath(path.dirname(file), this.compiledPath)) return false;
		const name = path.basename(file);
		return this.tools.some(({ cacheFiles }) => cacheFiles?.includes(name));
	}

	isReadOnly(source: string): boolean {
		return this.tools.some((tool) => tool.readsOnly?.(source));
	}

	rojoPath(filePath: string): OptionalRojoPath {
		return { optional: this.relativeToProject(this.emittedPath(filePath)) };
	}

	rojoFolderPath(dir: string): OptionalRojoPath {
		return { optional: this.compiledFolderOf(dir) };
	}

	placeholdersOf(
		projectFile: RojoProjectFile,
		isSourceFolder: (source: string) => boolean
	): Placeholder[] {
		const { compiledPath } = this;
		if (compiledPath === undefined) return [];
		const written = [
			compiledPath,
			...this.tools.flatMap(({ runtimeFolder }) =>
				runtimeFolder
					? path.resolve(this.projectDir, runtimeFolder)
					: []
			),
		];
		return new RojoProject(projectFile)
			.mountedPaths()
			.map(({ path: rojoPath }) =>
				path.resolve(this.projectDir, rojoPathTarget(rojoPath))
			)
			.filter((target) => written.some((dir) => contains(dir, target)))
			.flatMap((target): Placeholder[] => {
				const source = path.join(
					this.commonRoot,
					path.relative(compiledPath, target)
				);
				if (isSourceFolder(toPosix(source)))
					return [{ path: target, kind: "folder" }];
				const file = RojoFile.at(toPosix(target), this.syncRules);
				if (file.isLuau) return [{ path: target, kind: "script" }];
				return file.isSyncedByRojo
					? []
					: [{ path: target, kind: "folder" }];
			});
	}
}
