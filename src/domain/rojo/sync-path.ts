import path from "path";
import { toPosix } from "../../base/path.js";
import { OptionalRojoPath } from "./rojo-project.js";

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
