import { configPath } from "../../platform/config/config-path.js";
import { ConfigBuild } from "../../domain/build/build.js";
import {
	SyncbackChange,
	SyncbackPlan,
	UnplacedInstance,
} from "../../domain/syncback/syncback.js";
import {
	DiagnosticJson,
	diagnosticShape,
	diagnosticToJson,
	errorShape,
	failureToJson,
} from "../../platform/diagnostics/diagnostic-json.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { buildDocument, buildEntryShape } from "../build/build-document.js";

const S = OutputShape;

const syncbackEntryShape = S.named(
	"SyncbackEntry",
	S.object({
		outcome: S.enum("written", "wouldWrite", "failed", "notRun"),
		config: S.nullable(S.string),
		input: S.string,
		changes: S.array(
			S.object({ kind: S.enum("write", "remove"), file: S.string })
		),
		unplaced: S.array(S.object({ instance: S.string, reason: S.string })),
		diagnostics: S.optional(S.array(diagnosticShape)),
		error: S.optional(errorShape),
	})
);

/** The document of `syncback --json`. */
export const syncbackDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(buildEntryShape),
	syncback: syncbackEntryShape,
});

export interface SyncbackEntry {
	readonly outcome: "written" | "wouldWrite" | "failed" | "notRun";
	/** The config file's path relative to the working folder. */
	readonly config: string | null;
	readonly input: string;
	readonly changes: readonly SyncbackChange[];
	readonly unplaced: readonly UnplacedInstance[];
	readonly diagnostics?: readonly DiagnosticJson[];
	readonly error?: unknown;
}

export type SyncbackOutcome =
	| { readonly kind: "notRun" }
	| { readonly kind: "failed"; readonly error: Error }
	| {
			readonly kind: "planned" | "written";
			readonly plan: SyncbackPlan;
			readonly warnings: readonly Diagnostic[];
	  };

export function syncbackEntry(
	input: string,
	outcome: SyncbackOutcome,
	cwd: string
): SyncbackEntry {
	if (outcome.kind === "notRun")
		return {
			outcome: "notRun",
			config: null,
			input,
			changes: [],
			unplaced: [],
		};
	if (outcome.kind === "failed")
		return {
			outcome: "failed",
			config: null,
			input,
			changes: [],
			unplaced: [],
			...failureToJson(outcome.error),
		};
	return {
		outcome: outcome.kind === "planned" ? "wouldWrite" : outcome.kind,
		config: configPath(cwd, outcome.plan.project.file),
		input,
		changes: outcome.plan.changes.map(({ kind, file }) => ({ kind, file })),
		unplaced: outcome.plan.unplaced,
		...(outcome.warnings.length > 0 && {
			diagnostics: outcome.warnings.map(diagnosticToJson),
		}),
	};
}

export function syncbackDocument(
	builds: readonly ConfigBuild[],
	cwd: string,
	syncback: SyncbackEntry
) {
	const built = buildDocument(builds, cwd);
	return {
		changed: built.changed || syncback.outcome === "written",
		configs: built.configs,
		syncback,
	};
}
