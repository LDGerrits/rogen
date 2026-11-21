import { containsPosix } from "../../base/path.js";
import { RoutedFile } from "./router.js";

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
