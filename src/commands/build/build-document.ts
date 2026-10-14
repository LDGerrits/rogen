import { toNative } from "../../base/path.js";
import { ConfigBuild, isWritten } from "../../domain/build/build.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	DiagnosticJson,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic-json.js";

export interface BuildEntry {
	readonly config: string;
	readonly file: string;
	readonly projectFile: string | null;
	readonly outcome: "wrote" | "unchanged" | "notWritten";
	readonly blockedBy?: readonly string[];
	readonly diagnostics: readonly DiagnosticJson[];
}

interface BuildDocument {
	readonly configs: readonly BuildEntry[];
}

export function buildEntry(
	build: ConfigBuild,
	diagnostics: readonly Diagnostic[] = build.diagnostics
): BuildEntry {
	const loaded = build.outcome !== "notLoaded";
	return {
		config: build.label,
		file: toNative(build.file),
		projectFile: loaded ? toNative(build.config.projectFile) : null,
		outcome: isWritten(build) ? build.outcome : "notWritten",
		...(build.outcome === "notWritten" && {
			blockedBy: build.blockedBy,
		}),
		diagnostics: diagnostics.map(diagnosticToJson),
	};
}

export function buildDocument(
	builds: readonly ConfigBuild[],
	diagnosticsOf: (build: ConfigBuild) => readonly Diagnostic[] = (build) =>
		build.diagnostics
): BuildDocument {
	return {
		configs: builds.map((build) => buildEntry(build, diagnosticsOf(build))),
	};
}
