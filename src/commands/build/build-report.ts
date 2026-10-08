import { toNative } from "../../base/path.js";
import { ConfigBuild } from "../../domain/build/build.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic.js";

/** What a build did to each config, as one JSON document. */
export class BuildReport {
	private readonly configs: Record<string, unknown>[] = [];

	add(build: ConfigBuild): void {
		const loaded = build.outcome !== "notLoaded";
		this.configs.push({
			config: build.label,
			file: toNative(loaded ? build.config.file : build.file),
			outFile: loaded ? toNative(build.config.outFile) : null,
			...(loaded && build.config.mode && { mode: build.config.mode }),
			outcome: build.documentOutcome,
			...(build.outcome === "notWritten" && {
				blockedBy: build.blockedBy,
			}),
			diagnostics: build.diagnostics.map(diagnosticToJson),
		});
	}

	json(): Record<string, unknown> {
		return { configs: this.configs };
	}
}
