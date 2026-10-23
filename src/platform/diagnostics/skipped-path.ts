import { relativeTo, toNative } from "../../base/path.js";
import { OutputShape } from "../output/output-shape.js";

/** A path given to `check` or `where` that no build reads. */
export interface SkippedPath {
	/** An absolute POSIX path. */
	readonly path: string;
	/** `outsideSourcePaths`: a config covers its folder but no source path holds it. `noConfig`: no config at or above it. */
	readonly reason: "outsideSourcePaths" | "noConfig";
	/** For `outsideSourcePaths`: the absolute POSIX path of the config that covers its folder (in a document, relative to the working folder). */
	readonly config?: string;
}

export interface SkippedPathJson {
	readonly path: string;
	readonly reason: SkippedPath["reason"];
	readonly config?: string;
}

export const skippedPathShape = OutputShape.named(
	"SkippedPath",
	OutputShape.object({
		path: OutputShape.string,
		reason: OutputShape.enum("outsideSourcePaths", "noConfig"),
		config: OutputShape.optional(OutputShape.string),
	})
);

function skippedPathToJson(
	{ path, reason, config }: SkippedPath,
	cwd: string
): SkippedPathJson {
	return {
		path: toNative(path),
		reason,
		...(config && { config: relativeTo(cwd, config) }),
	};
}

/** For a document: `skipped`, and only when something was. */
export function skippedJson(
	skipped: readonly SkippedPath[],
	cwd: string
): {
	readonly skipped?: SkippedPathJson[];
} {
	return skipped.length > 0
		? { skipped: skipped.map((one) => skippedPathToJson(one, cwd)) }
		: {};
}
