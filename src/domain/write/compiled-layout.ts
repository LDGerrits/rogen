import path from "path";
import { contains, samePath, toPosix } from "../../base/path.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { CompiledPath } from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";
import {
	OptionalRojoPath,
	RojoProject,
	RojoProjectFile,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
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
	constructor(
		readonly compiled: CompiledPath,
		private readonly tools: readonly SyncTool[]
	) {}

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
		return toPosix(path.relative(this.compiled.projectDir, absolutePath));
	}

	emittedPath(filePath: string): string {
		if (this.compiled.folder === undefined) return filePath;
		const compiled = this.compiled.of(filePath);
		if (this.compiled.fileOf(toPosix(filePath)).isCompiled)
			return `${compiled.slice(0, compiled.length - path.extname(compiled).length)}.luau`;
		return this.tools.reduce(
			(emitted, tool) => tool.emittedPath?.(emitted) ?? emitted,
			compiled
		);
	}

	private compiledFolderOf(dir: string): string {
		return this.relativeToProject(this.compiled.of(dir));
	}

	syncedGlob(glob: string): string {
		return this.compiled.glob(glob);
	}

	isCacheFile(file: string): boolean {
		if (!samePath(path.dirname(file), this.compiled.folder!)) return false;
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
		const compiledPath = this.compiled.folder;
		if (compiledPath === undefined) return [];
		const written = [
			compiledPath,
			...this.tools.flatMap(({ runtimeFolder }) =>
				runtimeFolder
					? path.resolve(this.compiled.projectDir, runtimeFolder)
					: []
			),
		];
		return new RojoProject(projectFile)
			.mountedPaths()
			.map(({ path: rojoPath }) =>
				path.resolve(this.compiled.projectDir, rojoPathTarget(rojoPath))
			)
			.filter((target) => written.some((dir) => contains(dir, target)))
			.flatMap((target): Placeholder[] => {
				if (isSourceFolder(toPosix(this.compiled.sourceOf(target))))
					return [{ path: target, kind: "folder" }];
				const file = this.compiled.fileAt(target);
				if (file.isLuau) return [{ path: target, kind: "script" }];
				return file.isSyncedByRojo
					? []
					: [{ path: target, kind: "folder" }];
			});
	}
}
