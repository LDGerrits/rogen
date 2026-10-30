import path from "path";
import { toNative } from "../../base/path.js";
import { configPath } from "../../platform/config/config-path.js";
import { ConfigOutcome } from "../../domain/write/write.js";
import {
	CompiledChange,
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
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { configsDocument, writeEntryShape } from "../write/write-document.js";

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
	configs: S.array(writeEntryShape),
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

/** A warning for each change to compiled code that syncback left out of the plan. */
export function compiledDiagnostics(plan: SyncbackPlan): Diagnostic[] {
	const { compiledPath, projectDir, file } = plan.project;
	if (compiledPath === undefined) return [];
	const folder = toNative(path.relative(projectDir, compiledPath));
	const messages: Record<
		CompiledChange["kind"],
		(instance: string) => string
	> = {
		changed: (instance) =>
			`${instance} changed in the place, but it is compiled into ${folder}, so syncback left it out. Make the change in the source files.`,
		removed: (instance) =>
			`${instance} was removed from the place, but it is compiled into ${folder}, so syncback left it out. Remove it from the source files.`,
		added: (instance) =>
			`${instance} is new in the place, but the project compiles into ${folder}, so syncback left it out. Add it to the source files.`,
	};
	return plan.compiled.map(({ instance, kind }) =>
		warningDiagnostic(
			"syncback.compiledPath",
			{ resource: file },
			messages[kind](instance)
		)
	);
}

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
	const diagnostics = [
		...compiledDiagnostics(outcome.plan),
		...outcome.warnings,
	];
	return {
		outcome: outcome.kind === "planned" ? "wouldWrite" : outcome.kind,
		config: configPath(cwd, outcome.plan.project.file),
		input,
		changes: outcome.plan.changes.map(({ kind, file }) => ({ kind, file })),
		unplaced: outcome.plan.unplaced,
		...(diagnostics.length > 0 && {
			diagnostics: diagnostics.map(diagnosticToJson),
		}),
	};
}

export function syncbackDocument(
	outcomes: readonly ConfigOutcome[],
	cwd: string,
	syncback: SyncbackEntry
) {
	const written = configsDocument(outcomes, cwd);
	return {
		changed:
			written.changed ||
			(syncback.outcome === "written" && syncback.changes.length > 0),
		configs: written.configs,
		syncback,
	};
}
