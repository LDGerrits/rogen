import picomatch from "picomatch";
import { isWindows } from "./platform.js";

export type GlobPattern = string;

const MAGIC = /[(){}|[\]*?!+@]/g;

/** `directory` as a glob prefix that matches only itself: a folder named `a (1)` or `{b}` would otherwise be read as part of the pattern. */
export function escapedGlobPrefix(directory: string): string {
	return directory.replace(MAGIC, "[$&]");
}

/** `glob` as its author wrote it, with the escapes of `escapedGlobPrefix` taken off. */
export function unescapedGlob(glob: GlobPattern): string {
	return glob.replace(/\[([(){}|[\]*?!+@])\]/g, "$1");
}

export function isMatch(path: string, glob: GlobPattern): boolean {
	return picomatch.isMatch(path, glob, {
		dot: true,
		windows: isWindows,
	});
}
