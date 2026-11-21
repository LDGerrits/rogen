import { containsPosix } from "../../base/path.js";
import { RoutedFile } from "./router.js";

const routesThrough = (
	target: string,
	{ entry, routedBy }: RoutedFile
): boolean =>
	routedBy !== undefined &&
	containsPosix(target, entry.source) &&
	containsPosix(routedBy, target);

export function governingRouteOf(
	target: string,
	routed: readonly RoutedFile[]
): string | undefined {
	return routed.find(
		(file) => routesThrough(target, file) && file.routedBy !== target
	)?.route;
}

export function governingRouteOfMarkerFolder(
	folder: string,
	routed: readonly RoutedFile[]
): string | undefined {
	return routed.find((file) => routesThrough(folder, file))?.route;
}
