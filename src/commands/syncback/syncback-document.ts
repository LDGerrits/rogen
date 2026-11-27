import { configPath } from "../../platform/config/config-path.js";
import { ConfigOutcome } from "../../domain/write/write.js";
import {
	SyncbackChange,
	SyncbackOutcome,
	UnplacedInstance,
} from "../../domain/syncback/syncback.js";
import {
	DiagnosticJson,
	diagnosticShape,
	diagnosticToJson,
	errorShape,
	failureToJson,
} from "../../platform/diagnostics/diagnostic-json.js";
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

export const syncbackDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	syncback: syncbackEntryShape,
});

interface SyncbackEntry {
	readonly outcome: "written" | "wouldWrite" | "failed" | "notRun";
	readonly config: string | null;
	readonly input: string;
	readonly changes: readonly SyncbackChange[];
	readonly unplaced: readonly UnplacedInstance[];
	readonly diagnostics?: readonly DiagnosticJson[];
	readonly error?: unknown;
}

export function syncbackEntry(
	input: string,
	outcome: SyncbackOutcome,
	cwd: string
): SyncbackEntry {
	if (outcome.kind === "notRun" || outcome.kind === "failed")
		return {
			outcome: outcome.kind,
			config:
				outcome.kind === "failed"
					? configPath(cwd, outcome.configFile)
					: null,
			input,
			changes: [],
			unplaced: [],
			...(outcome.kind === "failed" && failureToJson(outcome.error)),
		};
	const diagnostics = [...outcome.compiled, ...outcome.warnings];
	return {
		outcome: outcome.kind === "written" ? "written" : "wouldWrite",
		config: configPath(cwd, outcome.plan.project.file),
		input,
		changes: outcome.plan.changes.map(({ kind, file }) => ({ kind, file })),
		unplaced: outcome.plan.unplaced,
		...(diagnostics.length > 0 && {
			diagnostics: diagnostics.map((diagnostic) =>
				diagnosticToJson(diagnostic, cwd)
			),
		}),
	};
}

export function syncbackDocument(
	outcomes: readonly ConfigOutcome[],
	cwd: string,
	syncback: SyncbackEntry,
	changed: boolean
) {
	return {
		changed,
		configs: configsDocument(outcomes, cwd).configs,
		syncback,
	};
}
