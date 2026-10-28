import path from "path";
import { contains, containsPosix, samePath, toPosix } from "../../base/path.js";
import { ResolvedConfig, compiledPathOf } from "../config/resolved-config.js";
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

/** Rojo never watches a `$path` missing at load, so the write makes a folder or script there first. */
export interface Placeholder {
	readonly path: string;
	readonly kind: "folder" | "script";
}

export const PLACEHOLDER_SOURCE =
	"-- Rogen wrote this so Rojo watches it. Your compiler replaces it.\n";

/** Where a write's files are synced from: the source paths themselves, or the `compiledPath` that tools write them into. */
export class CompiledLayout {
	readonly commonRoot: string;
	readonly compiledPath: string | undefined;
	readonly projectDir: string;
	private readonly syncRules: SyncRules;

	/** `tools` are what rewrites code on its way to `compiledPath`. */
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

	/** The script names that make a file its folder: Rojo's `init`, and any name a tool writes as it. */
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

	/** The absolute path the tools write for `filePath` under `compiledPath`, or `filePath` itself when nothing syncs elsewhere. */
	emittedPath(filePath: string): string {
		if (this.compiledPath === undefined) return filePath;
		return this.tools.reduce(
			(emitted, tool) => tool.emittedPath?.(emitted) ?? emitted,
			compiledPathOf(this, filePath)
		);
	}

	/** A glob of the project written as it matches the files under the compiled path. */
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

	/** Whether `file` is one a tool writes at the root of the compiled path for itself. */
	isCacheFile(file: string): boolean {
		if (this.compiledPath === undefined) return false;
		if (!samePath(path.dirname(file), this.compiledPath)) return false;
		const name = path.basename(file);
		return this.tools.some(({ cacheFiles }) => cacheFiles?.includes(name));
	}

	/** Whether a tool reads `source` without writing anything for it. */
	isReadOnly(source: string): boolean {
		return this.tools.some((tool) => tool.readsOnly?.(source));
	}

	rojoPath(filePath: string): OptionalRojoPath {
		return { optional: this.relativeToProject(this.emittedPath(filePath)) };
	}

	/** The folders and Luau files `projectFile` mounts in the compiled path or a tool's runtime folder; any other file would be read before it is written. */
	placeholdersOf(projectFile: RojoProjectFile): Placeholder[] {
		if (this.compiledPath === undefined) return [];
		const written = [
			this.compiledPath,
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
				const file = RojoFile.at(toPosix(target), this.syncRules);
				if (file.isLuau) return [{ path: target, kind: "script" }];
				return file.isSyncedByRojo
					? []
					: [{ path: target, kind: "folder" }];
			});
	}
}
