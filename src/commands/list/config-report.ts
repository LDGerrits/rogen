import { relativeTo, toNative } from "../../base/path.js";
import { ResolvedConfig, configLabel } from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

const listed = (values: readonly string[]): string =>
	values.length > 0 ? values.join(", ") : "(none)";

/** Every variant the config declares, with its state, in the order declared. */
const variantLines = ({ variants }: ResolvedConfig): string[] =>
	Object.entries(variants).map(
		([variant, on]) => `${variant} ${on ? "on" : "off"}`
	);

/** The configs a run read: as lines relative to the working dir, or as one JSON document with an entry per config. */
export class ConfigReport {
	constructor(private readonly entries: readonly ConfigEntry[]) {}

	/** One block per config: its file, what it extends, then its values or its errors. */
	print(logService: LogService, cwd: string): void {
		const relative = (file: string) => relativeTo(cwd, file);
		for (const entry of this.entries) {
			logService.step(relative(entry.file));
			if (entry.parents.length > 0) {
				logService.info(
					`extends: ${entry.parents.map(relative).join(" -> ")}`
				);
			}

			if (entry.status === "broken") {
				for (const error of entry.errors) logService.diagnostic(error);
				continue;
			}
			const { config } = entry;
			logService.info(
				[
					`root dirs: ${listed(config.rootDirs.map(relative))}`,
					`sync dir: ${listed(config.syncDir ? [relative(config.syncDir)] : [])}`,
					`project file: ${relative(config.outFile)}`,
					`variants: ${listed(variantLines(config))}`,
					...(config.conflicts.length > 0
						? [
								`conflicts: ${config.conflicts.map((group) => group.join(" | ")).join(", ")}`,
							]
						: []),
					...(config.mode !== undefined
						? [
								`mode: ${config.mode}`,
								`modes: ${config.modes.join(", ")}`,
							]
						: []),
				].join("\n")
			);
		}
	}

	json(): Record<string, unknown> {
		return {
			configs: this.entries.map((entry) => ({
				config: configLabel(entry.file),
				file: toNative(entry.file),
				status: entry.status,
				extends: entry.parents.map((file) => toNative(file)),
				...(entry.status === "valid"
					? describeConfig(entry.config)
					: {}),
				diagnostics:
					entry.status === "broken"
						? entry.errors.map(diagnosticToJson)
						: [],
			})),
		};
	}
}

function describeConfig(config: ResolvedConfig): Record<string, unknown> {
	return {
		projectName: config.name,
		rootDirs: config.rootDirs.map((file) => toNative(file)),
		commonRoot: config.commonRoot ? toNative(config.commonRoot) : null,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, target.toString()])
		),
		variants: config.variants,
		conflicts: config.conflicts,
		mode: config.mode ?? null,
		modes: config.modes,
		exclude: config.exclude,
		template: config.template ? toNative(config.template.file) : null,
		syncDir: config.syncDir ? toNative(config.syncDir) : null,
		outFile: toNative(config.outFile),
	};
}
