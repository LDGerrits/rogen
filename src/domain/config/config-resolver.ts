import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { CONFIG_SUFFIX } from "./config-discovery.js";
import { LayeredConfig } from "./config-layers.js";
import { validateConfig } from "./config-validation.js";
import { ResolvedConfig, ResolvedTemplate } from "./config.js";

const PROJECT_FILE_SUFFIX = ".project.json";
const FALLBACK_NAME = "project";

export function resolveConfig(
	layered: LayeredConfig,
	template: ResolvedTemplate | undefined
): Result<ResolvedConfig, Diagnostic[]> {
	const { config, files } = layered;
	const leaf = files[files.length - 1];
	const dir = path.dirname(leaf.file);
	const stem = path.basename(leaf.file, CONFIG_SUFFIX);
	const templateName = template?.project.name;

	const resolved: ResolvedConfig = {
		name:
			(typeof templateName === "string" && templateName) ||
			path.basename(dir) ||
			FALLBACK_NAME,
		rootDirs: config.getValue<string[]>("rootDirs"),
		routes: config.getValue<Record<string, string>>("routes"),
		tags: config.getValue<Record<string, boolean>>("tags"),
		exclude: config.getValue<string[]>("exclude"),
		...(template && { template }),
		syncDir: config.getValue<string | undefined>("syncDir"),
		outFile:
			config.getValue<string | undefined>("outFile") ??
			path.join(dir, `${stem}${PROJECT_FILE_SUFFIX}`),
	};

	const problems = validateConfig(layered, resolved);
	return problems.length > 0 ? err(problems) : ok(resolved);
}
