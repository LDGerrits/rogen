import { toNative } from "../../base/path.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic.js";

/** The configs a run read, as one JSON document keyed by config file. */
export class ConfigReport {
	constructor(private readonly entries: readonly ConfigEntry[]) {}

	json(): Record<string, unknown> {
		return Object.fromEntries(
			this.entries.map((entry) => [
				toNative(entry.file),
				{
					extends: entry.parents.map((file) => toNative(file)),
					...(entry.status === "valid"
						? describeConfig(entry.config)
						: {}),
					diagnostics:
						entry.status === "broken"
							? entry.errors.map(diagnosticToJson)
							: [],
				},
			])
		);
	}
}

function describeConfig(config: ResolvedConfig): Record<string, unknown> {
	return {
		name: config.name,
		rootDirs: config.rootDirs.map((file) => toNative(file)),
		commonRoot: config.commonRoot ? toNative(config.commonRoot) : null,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, target.toString()])
		),
		tags: config.tags,
		exclude: config.exclude,
		template: config.template ? toNative(config.template.file) : null,
		syncDir: config.syncDir ? toNative(config.syncDir) : null,
		outFile: toNative(config.outFile),
	};
}
