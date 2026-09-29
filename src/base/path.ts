import path from "path";

const POSIX_SEP = path.posix.sep;

export function toPosix(filePath: string): string {
	return filePath.replace(/\\/g, POSIX_SEP);
}

export function joinPosix(...segments: string[]): string {
	return toPosix(path.join(...segments));
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

/** `filePath` from `from`, with `.` for `from` itself. */
export function relativeTo(from: string, filePath: string): string {
	return path.relative(from, filePath) || ".";
}

/** A file name without its last extension. */
export function stemOf(fileName: string): string {
	return fileName.slice(0, fileName.length - path.extname(fileName).length);
}
