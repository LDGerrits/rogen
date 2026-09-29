import path from "path";
import { toPosix } from "../../base/path.js";
import { OptionalRojoPath } from "../rojo/rojo-tree.js";
import { commonRoot } from "../config/common-root.js";

export interface SyncLayout {
	readonly commonRoot: string;
	readonly syncDir?: string;
	readonly projectDir: string;
}

const COMPILED_EXTENSION = /\.tsx?$/i;

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

/** The absolute path a compiler emits for `filePath` under `syncDir`. */
export function emittedPath(
	filePath: string,
	commonRootDir: string,
	syncDir: string
): string {
	return path
		.join(syncDir, path.relative(commonRootDir, filePath))
		.replace(COMPILED_EXTENSION, ".luau");
}

export function syncPath(
	filePath: string,
	layout: SyncLayout
): OptionalRojoPath {
	if (!layout.syncDir) {
		return { optional: relativeToProject(filePath, layout.projectDir) };
	}

	return {
		optional: relativeToProject(
			emittedPath(filePath, layout.commonRoot, layout.syncDir),
			layout.projectDir
		),
	};
}
