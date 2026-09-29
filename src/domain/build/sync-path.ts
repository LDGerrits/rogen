import path from "path";
import { toPosix } from "../../base/path.js";
import { commonRoot } from "../config/common-root.js";
import { ResolvedConfig } from "../config/config.js";
import { OptionalRojoPath } from "../rojo/rojo-tree.js";
import { SyncTool } from "../toolchain/toolchain.js";

export interface SyncLayout {
	readonly commonRoot: string;
	readonly syncDir?: string;
	readonly projectDir: string;
	/** What rewrites code on its way to `syncDir`. */
	readonly tools: readonly SyncTool[];
}

export interface SyncedLayout extends SyncLayout {
	readonly syncDir: string;
}

export const isSynced = (layout: SyncLayout): layout is SyncedLayout =>
	layout.syncDir !== undefined;

export function syncLayoutOf(
	config: Pick<ResolvedConfig, "rootDirs" | "syncDir" | "outFile">,
	tools: readonly SyncTool[]
): SyncLayout {
	return {
		commonRoot: commonRoot(config.rootDirs),
		syncDir: config.syncDir,
		projectDir: path.dirname(config.outFile),
		tools,
	};
}

export function relativeToProject(
	absolutePath: string,
	projectDir: string
): string {
	return toPosix(path.relative(projectDir, absolutePath));
}

/**
 * A `$path` target from the template is real source on disk (Wally's
 * `Packages`, rbxts's `include`), so it is only rebased, never moved under
 * `syncDir`.
 */
export function rebaseTemplatePath(
	target: string,
	templateDir: string,
	projectDir: string
): string {
	return relativeToProject(path.resolve(templateDir, target), projectDir);
}

/** The absolute path the layout's tools write for `filePath` under `syncDir`. */
export function emittedPath(filePath: string, layout: SyncedLayout): string {
	return layout.tools.reduce(
		(emitted, tool) => tool.emittedPath?.(emitted) ?? emitted,
		path.join(layout.syncDir, path.relative(layout.commonRoot, filePath))
	);
}

/** Whether a tool reads `source` without writing anything for it. */
export const isReadOnly = (source: string, layout: SyncLayout): boolean =>
	layout.tools.some((tool) => tool.readsOnly?.(source));

export function syncPath(
	filePath: string,
	layout: SyncLayout
): OptionalRojoPath {
	if (!isSynced(layout)) {
		return { optional: relativeToProject(filePath, layout.projectDir) };
	}

	return {
		optional: relativeToProject(
			emittedPath(filePath, layout),
			layout.projectDir
		),
	};
}
