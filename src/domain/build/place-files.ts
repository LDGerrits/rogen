import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { applyTags } from "./apply-tags.js";
import { LeftOut } from "./left-out.js";
import { ScannedRoot } from "./root-scanner.js";
import { RoutedFile, routeFiles } from "./route-files.js";

/** Where every scanned file lands, or why it lands nowhere. */
export interface Placement {
	readonly roots: readonly ScannedRoot[];
	/** Every instance path appears once; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** Every path the build leaves out of the tree, by absolute POSIX path. */
	readonly leftOut: ReadonlyMap<string, LeftOut>;
	readonly warnings: readonly Diagnostic[];
}

/** Routes the scanned files, then applies the tags to them. */
export function placeFiles(
	roots: readonly ScannedRoot[],
	config: Pick<ResolvedConfig, "routes" | "tags" | "outFile">
): Result<Placement, Diagnostic[]> {
	const routing = routeFiles(roots, config);
	if (routing.isErr()) return routing;
	const tagging = applyTags(routing.value.routed, config);
	if (tagging.isErr()) return tagging;

	const unrouted = routing.value.unrouted.map((source): [string, LeftOut] => [
		source,
		{ status: "unrouted" },
	]);
	return ok({
		roots,
		files: tagging.value.files,
		leftOut: new Map([
			...roots.flatMap((root) => [...root.leftOut]),
			...unrouted,
			...tagging.value.leftOut,
		]),
		warnings: [...routing.value.warnings, ...tagging.value.warnings],
	});
}
