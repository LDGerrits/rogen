import path from "path";

/** The deepest directory containing every root dir. All paths must be absolute. Throws when `rootDirs` is empty. */
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
