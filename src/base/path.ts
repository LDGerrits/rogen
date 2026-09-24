import path from "path";

const POSIX_SEP = path.posix.sep;

export function toPosix(filePath: string): string {
	return filePath.replace(/\\/g, POSIX_SEP);
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
