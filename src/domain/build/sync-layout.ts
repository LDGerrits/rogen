import path from "path";
import { toPosix } from "../../base/path.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoFile } from "../rojo/rojo.js";
import { OptionalRojoPath } from "../rojo/rojo-project.js";
import { DataReplacement, MetaReplacement, SyncTool } from "./sync-tool.js";

/** Where a build's files are synced from: the root dirs themselves, or the `syncDir` that tools write them into. */
export class SyncLayout {
	readonly commonRoot: string;
	readonly syncDir: string | undefined;
	readonly projectDir: string;

	/** `tools` are what rewrites code on its way to `syncDir`. */
	constructor(
		config: Pick<ResolvedConfig, "commonRoot" | "syncDir" | "projectDir">,
		private readonly tools: readonly SyncTool[]
	) {
		this.commonRoot = config.commonRoot ?? config.projectDir;
		this.syncDir = config.syncDir;
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

	/** The absolute path the tools write for `filePath` under `syncDir`, or `filePath` itself when nothing syncs elsewhere. */
	emittedPath(filePath: string): string {
		if (this.syncDir === undefined) return filePath;
		return this.tools.reduce(
			(emitted, tool) => tool.emittedPath?.(emitted) ?? emitted,
			path.join(this.syncDir, path.relative(this.commonRoot, filePath))
		);
	}

	/** Whether a tool reads `source` without writing anything for it. */
	isReadOnly(source: string): boolean {
		return this.tools.some((tool) => tool.readsOnly?.(source));
	}

	/** The `$path` Rojo mounts for `filePath`. Optional, since a compiler may not have written it yet. */
	syncPath(filePath: string): OptionalRojoPath {
		return { optional: this.relativeToProject(this.emittedPath(filePath)) };
	}
}
