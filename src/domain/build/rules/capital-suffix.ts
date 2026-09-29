import { instanceKey } from "../../rojo/rojo-tree.js";
import { BuildRule, RoutedFile, declaredKeysOf } from "../build-record.js";
import { diagnosePaths } from "../path-list.js";
import { RouteDiagnostics } from "../route-diagnostics.js";

/** A capital suffix routes a file whose name may only happen to end in a route key. */
export const capitalSuffix: BuildRule = ({ config, routed }) => {
	const bySource = new Map<string, RoutedFile>(
		routed
			.filter(({ separatorName }) => separatorName)
			.map((file) => [file.entry.source, file])
	);
	const shared = [...declaredKeysOf(config).routeKeys].find(
		(key) => key.toLowerCase() === "shared"
	);
	return diagnosePaths([...bySource.keys()], (resource) => {
		const file = bySource.get(resource) as RoutedFile;
		return RouteDiagnostics.capitalSuffix(
			{ resource },
			file.route,
			instanceKey(file.instancePath),
			file.separatorName as string,
			shared
		);
	});
};
