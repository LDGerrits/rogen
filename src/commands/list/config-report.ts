import { relativeTo } from "../../base/path.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic.js";

/** The configs a run read, as one JSON document keyed by config file. */
export class ConfigReport {
	private readonly entries: ConfigEntry[] = [];

	constructor(private readonly cwd: string) {}

	add(entry: ConfigEntry): void {
		this.entries.push(entry);
	}

	json(): Record<string, unknown> {
		return Object.fromEntries(
			this.entries.map((entry) => [
				relativeTo(this.cwd, entry.file),
				{
					extends: entry.parents,
					...(!entry.isBroken && entry.resolved
						? describeConfig(entry.resolved)
						: {}),
					diagnostics: entry.diagnostics.map(diagnosticToJson),
				},
			])
		);
	}
}

function describeConfig(config: ResolvedConfig): Record<string, unknown> {
	return {
		name: config.name,
		rootDirs: config.rootDirs,
		commonRoot: config.commonRoot ?? null,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, target.toString()])
		),
		tags: config.tags,
		exclude: config.exclude,
		template: config.template?.file ?? null,
		syncDir: config.syncDir ?? null,
		outFile: config.outFile,
	};
}
