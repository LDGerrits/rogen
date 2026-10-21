import { isDeepStrictEqual } from "util";
import { ResolvedConfig } from "./resolved-config.js";

const routeLines = ({ routes }: ResolvedConfig): string[] =>
	[...routes].map(([key, target]) => `${key} ${target.toString()}`);

/** How two configs of one folder differ. */
export class ConfigDifferences {
	/** The keys of `other` whose values differ from `base`'s, Rojo's first and Rogen's after. Both are in one folder, so their absolute paths compare. */
	static between(base: ResolvedConfig, other: ResolvedConfig): string[] {
		const baseFile: Record<string, unknown> = base.project.getFile();
		const otherFile: Record<string, unknown> = other.project.getFile();
		const rojo = [
			...new Set([...Object.keys(baseFile), ...Object.keys(otherFile)]),
		].filter((key) => !isDeepStrictEqual(baseFile[key], otherFile[key]));
		return [
			...rojo,
			...(isDeepStrictEqual(base.sourcePaths, other.sourcePaths)
				? []
				: ["sourcePaths"]),
			...(isDeepStrictEqual(routeLines(base), routeLines(other))
				? []
				: ["routes"]),
			...(base.syncPath === other.syncPath ? [] : ["syncPath"]),
		];
	}
}
