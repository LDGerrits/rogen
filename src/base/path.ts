import path from "path";
import { ignoresPathCase } from "./platform.js";

const POSIX_SEP = path.posix.sep;

export function toPosix(filePath: string): string {
	return filePath.replace(/\\/g, POSIX_SEP);
}

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

export function dirnamePosix(relativePath: string): string {
	const dir = path.posix.dirname(relativePath);
	return dir === "." ? "" : dir;
}

/**
 * Folds `a` and `b` where the file system ignores case, which `path.relative`
 * gets wrong on macOS.
 */
function foldedForRelative(
	a: string,
	b: string,
	caseInsensitive: boolean
): [string, string] {
	return caseInsensitive ? [a.toLowerCase(), b.toLowerCase()] : [a, b];
}

export function samePath(
	a: string,
	b: string,
	caseInsensitive = ignoresPathCase
): boolean {
	return path.relative(...foldedForRelative(a, b, caseInsensitive)) === "";
}

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

export function normalizeDir(entry: string): string {
	return path.posix.normalize(toPosix(entry.trim())).replace(/(.)\/+$/, "$1");
}

export function* ancestors(filePath: string): Generator<string> {
	let current = filePath;
	for (;;) {
		const parent = path.dirname(current);
		if (parent === current) return;
		yield parent;
		current = parent;
	}
}

export function* selfAndAncestors(folder: string): Generator<string> {
	yield folder;
	yield* ancestors(folder);
}

export function contains(parent: string, child: string): boolean {
	return samePath(child, parent) || isInside(child, parent);
}

export function containsPosix(parent: string, child: string): boolean {
	return child === parent || child.startsWith(`${parent}/`);
}

export function containsPath(
	parent: string,
	child: string,
	caseInsensitive = ignoresPathCase
): boolean {
	return caseInsensitive
		? containsPosix(parent.toLowerCase(), child.toLowerCase())
		: containsPosix(parent, child);
}

export function commonFolderPosix(dirs: readonly string[]): string {
	let folder = dirs[0];
	for (const dir of dirs)
		while (folder !== "." && !containsPosix(folder, dir))
			folder = path.posix.dirname(folder);
	return folder;
}

export function isBelowPosix(relative: string): boolean {
	return relative !== "." && relative !== ".." && !relative.startsWith("../");
}

export function outermostDirs(dirs: readonly string[]): string[] {
	const unique = [...new Set(dirs)];
	return unique.filter(
		(dir) => !unique.some((other) => isInside(dir, other))
	);
}

export function relativeTo(from: string, filePath: string): string {
	return path.relative(from, filePath) || ".";
}

export function shownFrom(from: string, filePath: string): string {
	return isInside(filePath, from, false)
		? toPosix(path.relative(from, filePath))
		: filePath;
}

export function stemOf(fileName: string): string {
	return fileName.slice(0, fileName.length - path.extname(fileName).length);
}

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
