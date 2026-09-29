import { Result, err, ok } from "../../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { Target, parseTarget } from "../../roblox/target.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import { declaredKeysOf } from "../keys/declared-key.js";
import { syncLayoutOf } from "../layout/sync-path.js";
import { templateProject } from "../layout/template.js";
import { PreparedBuild } from "../model/build-phases.js";

/** One error per config that declares no routes, since nothing could be placed. */
export function findConfigsWithoutRoutes(
	configs: readonly Pick<ResolvedConfig, "file" | "routes">[]
): Diagnostic[] {
	return configs
		.filter(({ routes }) => Object.keys(routes).length === 0)
		.map(({ file }) =>
			errorDiagnostic(
				"route.noRoutes",
				{ resource: file },
				'no routes declared, so nothing can be placed.\nAdd a "routes" map — `rogen init` writes a starting set.'
			)
		);
}

/** Settles everything the config decides, and fails on a config that can't build, before any file is scanned. */
export function prepareBuild(
	index: IndexReader,
	config: ResolvedConfig,
	tools: readonly SyncTool[]
): Result<PreparedBuild, Diagnostic[]> {
	const withoutRoutes = findConfigsWithoutRoutes([config]);
	if (withoutRoutes.length > 0) return err(withoutRoutes);

	const targets = new Map<string, Target>();
	const errors: Diagnostic[] = [];
	for (const [key, value] of Object.entries(config.routes)) {
		const target = parseTarget(value, { resource: config.outFile });
		if (target.isOk()) targets.set(key, target.value);
		else errors.push(...target.error);
	}
	if (errors.length > 0) return err(errors);

	const layout = syncLayoutOf(config, tools);
	return ok({
		config,
		index,
		layout,
		template: templateProject(config, layout.projectDir),
		keys: declaredKeysOf(config),
		targets,
	});
}
