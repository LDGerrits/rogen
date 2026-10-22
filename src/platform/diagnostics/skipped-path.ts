import { relativeTo, toNative } from "../../base/path.js";
import { joinedWithOr } from "../../base/strings.js";
import { OutputShape } from "../output/output-shape.js";

/** A path given to `check` or `where` that no build reads. */
export interface SkippedPath {
	/** An absolute POSIX path. */
	readonly path: string;
	/** `outsideSourcePaths`: a config covers its folder but no source path holds it. `noConfig`: no config at or above it. */
	readonly reason: "outsideSourcePaths" | "noConfig";
	/** For `outsideSourcePaths`: the absolute POSIX path of the config that covers its folder. */
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

export function skippedPathToJson({
	path,
	reason,
	config,
}: SkippedPath): SkippedPathJson {
	return {
		path: toNative(path),
		reason,
		...(config && { config: toNative(config) }),
	};
}

/** For a document: `skipped`, and only when something was. */
export function skippedJson(skipped: readonly SkippedPath[]): {
	readonly skipped?: SkippedPathJson[];
} {
	return skipped.length > 0
		? { skipped: skipped.map(skippedPathToJson) }
		: {};
}

/** What a command says of a skipped path; `named` are the named configs of the working folder, which `noConfig` offers as the way to ask instead: `lead` through one, as `rogen <command> <name>`. */
export function skippedNote(
	skipped: SkippedPath,
	cwd: string,
	ask: { readonly command: string; readonly lead: string },
	named: readonly string[]
): string {
	const path = relativeTo(cwd, skipped.path);
	if (skipped.reason === "outsideSourcePaths")
		return `note: ${path}: in no source path of ${relativeTo(cwd, skipped.config ?? "")}, so no build reads it.`;
	const hint =
		named.length > 0
			? ` ${ask.lead} through one: rogen ${ask.command} ${joinedWithOr(named)}.`
			: "";
	return `note: ${path}: no config at or above it reads it.${hint}`;
}
