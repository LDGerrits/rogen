import path from "path";
import { toPosix } from "../../base/path.js";
import { OptionalRojoPath, RojoPath } from "../rojo/rojo-tree.js";

export interface SyncLayout {
	readonly commonRoot: string;
	readonly syncDir?: string;
	readonly projectDir: string;
}

const COMPILED_EXTENSION = /\.tsx?$/i;

/** All paths must be absolute. Throws when `rootDirs` is empty. */
export function commonRoot(rootDirs: readonly string[]): string {
	if (rootDirs.length === 0) {
		throw new Error("commonRoot needs at least one root dir.");
	}

	const { root } = path.parse(rootDirs[0]);
	const split = (dir: string) =>
		path.relative(root, dir).split(path.sep).filter(Boolean);

	let shared = split(rootDirs[0]);
	for (const dir of rootDirs.slice(1)) {
		const segments = split(dir);
		const length = shared.findIndex(
			(segment, index) => segments[index] !== segment
		);
		shared = shared.slice(0, length === -1 ? shared.length : length);
	}

	return path.join(root, ...shared);
}

export function relativeToProject(
	absolutePath: string,
	projectDir: string
): string {
	return toPosix(path.relative(projectDir, absolutePath));
}

/**
 * A `$path` from the template is real source on disk (Wally's `Packages`,
 * rbxts's `include`), so it is only rebased, never moved under `syncDir`.
 * Its form, plain or optional, is the template author's and is kept.
 */
export function rebaseTemplatePath(
	templatePath: RojoPath,
	templateDir: string,
	projectDir: string
): RojoPath {
	const rebase = (target: string) =>
		relativeToProject(path.resolve(templateDir, target), projectDir);

	return typeof templatePath === "string"
		? rebase(templatePath)
		: { optional: rebase(templatePath.optional) };
}

export function syncPath(
	filePath: string,
	layout: SyncLayout
): OptionalRojoPath {
	if (!layout.syncDir) {
		return { optional: relativeToProject(filePath, layout.projectDir) };
	}

	const emitted = path.join(
		layout.syncDir,
		path.relative(layout.commonRoot, filePath)
	);
	return {
		optional: relativeToProject(
			emitted.replace(COMPILED_EXTENSION, ".luau"),
			layout.projectDir
		),
	};
}
