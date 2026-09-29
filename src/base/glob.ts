import picomatch from "picomatch";
import { isWindows } from "./platform.js";

export type GlobPattern = string;

export function isMatch(path: string, glob: GlobPattern): boolean {
	return picomatch.isMatch(path, glob, {
		dot: true,
		windows: isWindows,
	});
}
