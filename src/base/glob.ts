import picomatch from "picomatch";
import { isWindows } from "./platform.js";

export type GlobPattern = string;

export interface GlobIncludeOptions {
	readonly include?: readonly GlobPattern[];
	readonly exclude?: readonly GlobPattern[];
}

export function isMatch(path: string, glob: GlobPattern): boolean {
	return picomatch.isMatch(path, glob, {
		dot: true,
		windows: isWindows,
	});
}

/**
 * Evaluates filters where 'exclude' take priority over 'include'.
 * Defaults to true when there are no options provided or when filters are empty.
 */
export function shouldInclude(
	path: string,
	options: GlobIncludeOptions | undefined
): boolean {
	if (!options) return true;

	if (options.exclude?.some((x) => isMatch(path, x))) {
		return false;
	}

	if (options.include && options.include.length > 0) {
		return options.include.some((x) => isMatch(path, x));
	}

	return true;
}
