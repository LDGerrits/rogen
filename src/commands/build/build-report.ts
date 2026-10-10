import { toNative } from "../../base/path.js";
import { ConfigBuild, isWritten } from "../../domain/build/build.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	DiagnosticJson,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic-json.js";

/** What a build did to one config, as the document lists it. */
export interface BuildEntry {
	readonly config: string;
	readonly file: string;
	/** `null` for a config that didn't load. */
	readonly outFile: string | null;
	readonly mode?: string;
	readonly outcome: "wrote" | "unchanged" | "notWritten";
	/** The labels of the configs whose failure stopped this one from being written. */
	readonly blockedBy?: readonly string[];
	readonly diagnostics: readonly DiagnosticJson[];
}

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
		outcome: isWritten(build) ? build.outcome : "notWritten",
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
