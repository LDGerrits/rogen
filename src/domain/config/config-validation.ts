import { isInside } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { parseTarget } from "../roblox/target.js";
import { ConfigDiagnostics } from "./config-diagnostics.js";
import { LayeredConfig, locateConfigValue } from "./config-layers.js";
import { ResolvedConfig } from "./config.js";

const FALLBACK_ROUTE = "*";
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** Every rule that can be checked without touching the source tree. */
export function validateConfig(
	layered: LayeredConfig,
	resolved: ResolvedConfig
): Diagnostic[] {
	const locate = (...section: string[]) =>
		locateConfigValue(layered, section);
	const problems: Diagnostic[] = [];

	const routeKeys = Object.keys(resolved.routes);
	for (const key of routeKeys) {
		const location = locate("routes", key);
		if (key !== FALLBACK_ROUTE && !NAME_PATTERN.test(key)) {
			problems.push(ConfigDiagnostics.invalidRouteKey(location, key));
		}
		const target = parseTarget(resolved.routes[key], location);
		if (target.isErr()) problems.push(...target.error);
	}

	for (const tag of Object.keys(resolved.tags)) {
		const location = locate("tags", tag);
		if (!NAME_PATTERN.test(tag)) {
			problems.push(ConfigDiagnostics.invalidTagName(location, tag));
		} else if (routeKeys.includes(tag)) {
			problems.push(ConfigDiagnostics.tagClashesWithRoute(location, tag));
		}
	}

	if (resolved.template?.file === resolved.outFile) {
		const explicit = layered.config.inspect("outFile").source?.tier;
		problems.push(
			ConfigDiagnostics.outFileIsTemplate(
				explicit === "layer" ? locate("outFile") : locate("template"),
				resolved.outFile
			)
		);
	}

	resolved.rootDirs.forEach((inner, index) => {
		const outer = resolved.rootDirs.find(
			(other) => other !== inner && isInside(inner, other)
		);
		if (outer !== undefined) {
			problems.push(
				ConfigDiagnostics.nestedRootDir(
					locate("rootDirs", String(index)),
					inner,
					outer
				)
			);
		}
	});

	return problems;
}
