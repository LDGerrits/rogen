import path from "path";
import { commonRoot } from "../../domain/build/sync-path.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { entryErrors } from "../../domain/config/valid-configs.js";
import { renderDiagnostic } from "../../platform/diagnostics/render-diagnostic.js";

function describeConfig(config: ResolvedConfig): Record<string, unknown> {
	return {
		name: config.name,
		rootDirs: config.rootDirs,
		commonRoot:
			config.rootDirs.length > 0 ? commonRoot(config.rootDirs) : null,
		routes: config.routes,
		tags: config.tags,
		exclude: config.exclude,
		template: config.template?.file ?? null,
		syncDir: config.syncDir ?? null,
		outFile: config.outFile,
	};
}

/** Strict JSON: the entry itself for one config, else an object keyed by config file. */
export function showConfig(entries: readonly ConfigEntry[]): string {
	const described = entries.map((entry): [string, unknown] => [
		path.basename(entry.file),
		entry.resolved
			? describeConfig(entry.resolved)
			: {
					diagnostics: entryErrors(entry).map(renderDiagnostic),
				},
	]);
	const value =
		described.length === 1
			? described[0][1]
			: Object.fromEntries(described);
	return JSON.stringify(value, null, 2);
}
