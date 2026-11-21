import { relativeTo, toNative } from "../../base/path.js";
import { OutputShape } from "../output/output-shape.js";

/** A path given to `check` or `where` that no write reads. */
export interface SkippedPath {
	/** An absolute POSIX path. */
	readonly path: string;
	/** `outsideSourcePaths`: a config covers its folder but no source path holds it. `noConfig`: no config at or above it. */
	readonly reason: "outsideSourcePaths" | "noConfig";
	/** For `outsideSourcePaths`: the absolute POSIX path of the config that covers its folder (in a document, relative to the working folder). */
	readonly config?: string;
	/** For `noConfig`: the absolute POSIX paths of the configs beside it that list it in their source paths, through which it can be asked about. */
	readonly readers?: readonly string[];
}

export interface SkippedPathJson {
	readonly path: string;
	readonly reason: SkippedPath["reason"];
	readonly config?: string;
	readonly readers?: string[];
}

export const skippedPathShape = OutputShape.named(
	"SkippedPath",
	OutputShape.object({
		path: OutputShape.string,
		reason: OutputShape.enum("outsideSourcePaths", "noConfig"),
		config: OutputShape.optional(OutputShape.string),
		readers: OutputShape.optional(OutputShape.array(OutputShape.string)),
	})
);

function skippedPathToJson(
	{ path, reason, config, readers }: SkippedPath,
	cwd: string
): SkippedPathJson {
	return {
		path: toNative(path),
		reason,
		...(config && { config: relativeTo(cwd, config) }),
		...(readers?.length && {
			readers: readers.map((file) => relativeTo(cwd, file)),
		}),
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
