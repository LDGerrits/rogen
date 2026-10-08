import { toNative } from "../../base/path.js";
import { ConfigBuild } from "../../domain/build/build.js";
import {
	Diagnostic,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic.js";

/** What a build did to each config, as one JSON document. */
export class BuildReport {
	private readonly configs: Record<string, unknown>[] = [];

	/** `diagnostics` stands in for everything the build found, for a caller that leaves some out. */
	add(
		build: ConfigBuild,
		diagnostics: readonly Diagnostic[] = build.diagnostics
	): void {
		const loaded = build.outcome !== "notLoaded";
		this.configs.push({
			config: build.label,
			file: toNative(build.file),
			outFile: loaded ? toNative(build.config.outFile) : null,
			...(loaded && build.config.mode && { mode: build.config.mode }),
			outcome:
				build.outcome === "wrote" || build.outcome === "unchanged"
					? build.outcome
					: "notWritten",
			...(build.outcome === "notWritten" && {
				blockedBy: build.blockedBy,
			}),
			diagnostics: diagnostics.map(diagnosticToJson),
		});
	}

	json(): Record<string, unknown> {
		return { configs: this.configs };
	}
}
