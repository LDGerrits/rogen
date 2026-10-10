import path from "path";

const POSIX_SEP = path.posix.sep;

export function toPosix(filePath: string): string {
	return filePath.replace(/\\/g, POSIX_SEP);
}

/** Paths found however they are written: a watcher reports POSIX paths on every system. */
export class PathSet {
	private readonly posix: ReadonlySet<string>;

	constructor(files: Iterable<string>) {
		this.posix = new Set([...files].map(toPosix));
	}

	has(file: string): boolean {
		return this.posix.has(toPosix(file));
	}
}

/** `filePath` as the platform writes it, the form a path is printed in. */
export function toNative(
	filePath: string,
	platform: typeof path.posix = path
): string {
	return platform.sep === POSIX_SEP
		? filePath
		: filePath.replace(/\//g, platform.sep);
}

export function joinPosix(...segments: string[]): string {
	return toPosix(path.join(...segments));
}

/** The directory of a relative POSIX path, `""` rather than `"."` at the top, so a root reads like the dirs below it. */
export function dirnamePosix(relativePath: string): string {
	const dir = path.posix.dirname(relativePath);
	return dir === "." ? "" : dir;
}

/** Whether two paths name one place, compared as paths, since a case-insensitive file system makes `Src` and `src` one folder. */
export function samePath(a: string, b: string): boolean {
	return path.relative(a, b) === "";
}

/** Whether `dir` lies strictly inside `parent`; both must be absolute. */
export function isInside(dir: string, parent: string): boolean {
	const relative = path.relative(parent, dir);
	return (
		relative !== "" &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

/** A relative directory with forward slashes, no leading `./` and no trailing `/`. */
export function normalizeDir(entry: string): string {
	return path.posix.normalize(toPosix(entry.trim())).replace(/(.)\/+$/, "$1");
}

/** The parent folder of `filePath`, then its parent, up to and including the root. */
export function* ancestors(filePath: string): Generator<string> {
	let current = filePath;
	for (;;) {
		const parent = path.dirname(current);
		if (parent === current) return;
		yield parent;
		current = parent;
	}
}

/** Whether `child` is `parent` or lies inside it; both must be absolute. */
export function contains(parent: string, child: string): boolean {
	return child === parent || isInside(child, parent);
}

/** Whether the POSIX path `child` is `parent` or lies under it, compared as text. */
export function containsPosix(parent: string, child: string): boolean {
	return child === parent || child.startsWith(`${parent}/`);
}

/** `dirs` without repeats and without any dir that lies inside another, in their first order. */
export function outermostDirs(dirs: readonly string[]): string[] {
	const unique = [...new Set(dirs)];
	return unique.filter(
		(dir) => !unique.some((other) => isInside(dir, other))
	);
}

/** `filePath` from `from`, with `.` for `from` itself. */
export function relativeTo(from: string, filePath: string): string {
	return path.relative(from, filePath) || ".";
}

/** A file name without its last extension. */
export function stemOf(fileName: string): string {
	return fileName.slice(0, fileName.length - path.extname(fileName).length);
}

/** The deepest directory containing every one of `dirs`. All paths must be absolute. Throws when `dirs` is empty. */
export function commonAncestor(dirs: readonly string[]): string {
	if (dirs.length === 0) {
		throw new Error("commonAncestor needs at least one directory.");
	}

	const { root } = path.parse(dirs[0]);
	const split = (dir: string) =>
		path.relative(root, dir).split(path.sep).filter(Boolean);

	let shared = split(dirs[0]);
	for (const dir of dirs.slice(1)) {
		const segments = split(dir);
		const length = shared.findIndex(
			(segment, index) => segments[index] !== segment
		);
		shared = shared.slice(0, length === -1 ? shared.length : length);
	}

	return path.join(root, ...shared);
}
