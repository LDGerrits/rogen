import path from "path";
import { containsPosix, toPosix } from "../../base/path.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";
import { OptionalRojoPath } from "../rojo/rojo-project.js";
import {
	DataReplacement,
	MetaReplacement,
	SyncTool,
} from "../toolchain/toolchain.js";

/** Where a build's files are synced from: the source paths themselves, or the `syncPath` that tools write them into. */
export class SyncLayout {
	readonly commonRoot: string;
	readonly syncPath: string | undefined;
	readonly projectDir: string;

	/** `tools` are what rewrites code on its way to `syncPath`. */
	constructor(
		config: Pick<ResolvedConfig, "commonRoot" | "syncPath" | "projectDir">,
		private readonly tools: readonly SyncTool[]
	) {
		this.commonRoot = config.commonRoot ?? config.projectDir;
		this.syncPath = config.syncPath;
		this.projectDir = config.projectDir;
	}

	/** The script names that make a file its folder: Rojo's `init`, and any name a tool writes as it. */
	get initNames(): ReadonlySet<string> {
		return new Set([
			RojoFile.INIT_NAME,
			...this.tools.flatMap(({ initName }) => initName ?? []),
		]);
	}

	/** What the tools write instead of a `.meta.json`, which Rojo then no longer applies. */
	get metaReplacements(): MetaReplacement[] {
		return this.tools.flatMap(
			({ metaReplacement }) => metaReplacement ?? []
		);
	}

	/** What the tools write instead of a data file. */
	get dataReplacements(): DataReplacement[] {
		return this.tools.flatMap(
			({ dataReplacement }) => dataReplacement ?? []
		);
	}

	relativeToProject(absolutePath: string): string {
		return toPosix(path.relative(this.projectDir, absolutePath));
	}

	/** The absolute path the tools write for `filePath` under `syncPath`, or `filePath` itself when nothing syncs elsewhere. */
	emittedPath(filePath: string): string {
		if (this.syncPath === undefined) return filePath;
		return this.tools.reduce(
			(emitted, tool) => tool.emittedPath?.(emitted) ?? emitted,
			path.join(this.syncPath, path.relative(this.commonRoot, filePath))
		);
	}

	/** A glob of the project written as it matches the files under the sync path: one that lies inside the source paths' common root names those files, and goes to the sync path in their place. */
	syncedGlob(glob: string): string {
		if (this.syncPath === undefined) return glob;
		const root = toPosix(this.commonRoot);
		const dir = toPosix(this.projectDir);
		const absolute = path.posix.join(dir, glob);
		if (!containsPosix(root, absolute)) return glob;
		return path.posix.relative(
			dir,
			path.posix.join(
				toPosix(this.syncPath),
				path.posix.relative(root, absolute)
			)
		);
	}

	/** Whether a tool reads `source` without writing anything for it. */
	isReadOnly(source: string): boolean {
		return this.tools.some((tool) => tool.readsOnly?.(source));
	}

	/** The `$path` Rojo mounts for `filePath`. Optional, since a compiler may not have written it yet. */
	rojoPath(filePath: string): OptionalRojoPath {
		return { optional: this.relativeToProject(this.emittedPath(filePath)) };
	}
}
