import { toNative } from "../../base/path.js";
import { ConfigBuild } from "../../domain/build/build.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic.js";

/** What a build did to each config, as one JSON document. */
export class BuildReport {
	private readonly configs: Record<string, unknown>[] = [];

	add(build: ConfigBuild): void {
		this.configs.push({
			file: toNative(build.config.file),
			outFile: toNative(build.config.outFile),
			outcome: build.documentOutcome,
			diagnostics: build.diagnostics.map(diagnosticToJson),
		});
	}

	json(): Record<string, unknown> {
		return { configs: this.configs };
	}
}
