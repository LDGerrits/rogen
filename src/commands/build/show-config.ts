import path from "path";
import { commonRoot } from "../../domain/build/sync-path.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";

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

/** Strict JSON: the config itself for one entry, else an object keyed by config file. */
export function showConfig(entries: readonly ConfigEntry[]): string {
	const described = entries.flatMap((entry): [string, unknown][] =>
		entry.resolved
			? [[path.basename(entry.file), describeConfig(entry.resolved)]]
			: []
	);
	const value =
		entries.length === 1
			? described[0]?.[1]
			: Object.fromEntries(described);
	return JSON.stringify(value ?? {}, null, 2);
}
