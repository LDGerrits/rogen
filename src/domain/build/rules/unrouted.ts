import { BuildRule } from "../build-record.js";
import { diagnosePaths } from "../path-list.js";
import { RouteDiagnostics } from "../route-diagnostics.js";

export const unrouted: BuildRule = ({ leftOut }) =>
	diagnosePaths(
		[...leftOut]
			.filter(([, why]) => why.status === "unrouted")
			.map(([source]) => source),
		(resource) => RouteDiagnostics.unrouted({ resource })
	);
