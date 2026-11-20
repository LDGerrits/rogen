import { containsPosix } from "../../base/path.js";
import { RoutedFile } from "./router.js";

/** The route that governs `target` from above: the route of a file at or in it that a folder or marker outside it routes. A folder named for a route there places nothing, and an `@` there names nothing. With `atItsFolder`, `target` is the folder a marker sits in, which a route given by that folder's own name governs too. */
export function governingRouteOf(
	target: string,
	routed: readonly RoutedFile[],
	atItsFolder = false
): string | undefined {
	return routed.find(
		({ entry, routedBy }) =>
			routedBy !== undefined &&
			containsPosix(target, entry.source) &&
			containsPosix(routedBy, target) &&
			(atItsFolder || routedBy !== target)
	)?.route;
}
