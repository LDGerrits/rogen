import { toNative } from "../../base/path.js";
import { ConfigBuild } from "../../domain/build/build.js";
import {
	Diagnostic,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic.js";

/** What a build did to one config, as the document lists it. */
export type BuildEntry = Record<string, unknown>;

/** What a build did to each config, as one JSON document. */
export interface BuildReport {
	readonly configs: readonly BuildEntry[];
}

/** What a build did to one config. `diagnostics` stands in for everything the build found, for a caller that leaves some out. */
export function buildEntry(
	build: ConfigBuild,
	diagnostics: readonly Diagnostic[] = build.diagnostics
): BuildEntry {
	const loaded = build.outcome !== "notLoaded";
	return {
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
	};
}

/** What a build did to each of `builds`, with `diagnosticsOf` standing in for what one found. */
export function buildReport(
	builds: readonly ConfigBuild[],
	diagnosticsOf: (build: ConfigBuild) => readonly Diagnostic[] = (build) =>
		build.diagnostics
): BuildReport {
	return {
		configs: builds.map((build) => buildEntry(build, diagnosticsOf(build))),
	};
}
