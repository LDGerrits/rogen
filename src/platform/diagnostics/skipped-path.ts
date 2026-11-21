import { relativeTo, toNative } from "../../base/path.js";
import { OutputShape } from "../output/output-shape.js";

export interface SkippedPath {
	readonly path: string;
	readonly reason: "outsideSourcePaths" | "noConfig";
	readonly config?: string;
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
