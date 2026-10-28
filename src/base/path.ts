import path from "path";
import { ignoresPathCase } from "./platform.js";

const POSIX_SEP = path.posix.sep;

export function toPosix(filePath: string): string {
	return filePath.replace(/\\/g, POSIX_SEP);
}

/** Paths compared however written: POSIX from watchers, case-folded where the file system ignores case. */
export class PathSet {
	private readonly keys: ReadonlySet<string>;

	constructor(
		files: Iterable<string>,
		private readonly caseInsensitive = ignoresPathCase
	) {
		this.keys = new Set([...files].map((file) => this.keyOf(file)));
	}

	has(file: string): boolean {
		return this.keys.has(this.keyOf(file));
	}

	private keyOf(file: string): string {
		const posix = toPosix(file);
		return this.caseInsensitive ? posix.toLowerCase() : posix;
	}
}

export function toNative(
	filePath: string,
	platform: typeof path.posix = path
): string {
	return platform.sep === POSIX_SEP
		? filePath
		: filePath.replace(/\//g, platform.sep);
}

/** `filePath` as one word of the shell on `platform`, in that platform's separators and quoted when the shell would split or expand it. */
export function toShellWord(
	filePath: string,
	platform: typeof path.posix = path
): string {
	const native = toNative(filePath, platform);
	const windows = platform.sep !== POSIX_SEP;
	const plain = windows ? /^[\w@%+=:,./\\-]+$/ : /^[\w@%+=:,./-]+$/;
	if (plain.test(native)) return native;
	return windows ? `"${native}"` : `'${native.replace(/'/g, `'\\''`)}'`;
}

export function joinPosix(...segments: string[]): string {
	return toPosix(path.join(...segments));
}

/** The directory of a relative POSIX path, `""` rather than `"."` at the top, so a root reads like the dirs below it. */
export function dirnamePosix(relativePath: string): string {
	const dir = path.posix.dirname(relativePath);
	return dir === "." ? "" : dir;
}

/** Folds `a` and `b` where the file system ignores case, which `path.relative` gets wrong on macOS. */
function foldedForRelative(
	a: string,
	b: string,
	caseInsensitive: boolean
): [string, string] {
	return caseInsensitive ? [a.toLowerCase(), b.toLowerCase()] : [a, b];
}

/** Whether two paths name one place, folding case where the file system does. */
export function samePath(
	a: string,
	b: string,
	caseInsensitive = ignoresPathCase
): boolean {
	return path.relative(...foldedForRelative(a, b, caseInsensitive)) === "";
}

/** Whether `dir` lies strictly inside `parent`; both must be absolute. */
export function isInside(
	dir: string,
	parent: string,
	caseInsensitive = ignoresPathCase
): boolean {
	const relative = path.relative(
		...foldedForRelative(parent, dir, caseInsensitive)
	);
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

/** Whether `child` is `parent` or lies inside it; both must be absolute, and may be written with either kind of separator. */
export function contains(parent: string, child: string): boolean {
	return samePath(child, parent) || isInside(child, parent);
}

/** Whether the POSIX path `child` is `parent` or lies under it, compared as text. */
export function containsPosix(parent: string, child: string): boolean {
	return child === parent || child.startsWith(`${parent}/`);
}

/** As `containsPosix`, folding case where the file system does. */
export function containsPath(
	parent: string,
	child: string,
	caseInsensitive = ignoresPathCase
): boolean {
	return caseInsensitive
		? containsPosix(parent.toLowerCase(), child.toLowerCase())
		: containsPosix(parent, child);
}

/** The deepest relative POSIX folder that holds every one of `dirs`, compared as text; `.` when they share none. */
export function commonFolderPosix(dirs: readonly string[]): string {
	let folder = dirs[0];
	for (const dir of dirs)
		while (folder !== "." && !containsPosix(folder, dir))
			folder = path.posix.dirname(folder);
	return folder;
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

export function stemOf(fileName: string): string {
	return fileName.slice(0, fileName.length - path.extname(fileName).length);
}

/** The deepest directory containing every one of `dirs`. All paths must be absolute. Throws when `dirs` is empty. */
export function commonAncestor(
	dirs: readonly string[],
	caseInsensitive = ignoresPathCase
): string {
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
			(segment, index) =>
				segments[index] === undefined ||
				(caseInsensitive
					? segments[index].toLowerCase() !== segment.toLowerCase()
					: segments[index] !== segment)
		);
		shared = shared.slice(0, length === -1 ? shared.length : length);
	}

	return path.join(root, ...shared);
}
