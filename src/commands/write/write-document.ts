import { configPath } from "../../platform/config/config-path.js";
import { toNative } from "../../base/path.js";
import {
	WriteRun,
	ConfigOutcome,
	isWritten,
} from "../../domain/write/write.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	DiagnosticJson,
	diagnosticShape,
	diagnosticToJson,
	errorShape,
} from "../../platform/diagnostics/diagnostic-json.js";
import { OutputShape } from "../../platform/output/output-shape.js";

const S = OutputShape;

export const writeEntryShape = S.named(
	"WriteEntry",
	S.object({
		config: S.string,
		projectFile: S.nullable(S.string),
		outcome: S.enum("wrote", "unchanged", "wouldWrite", "notWritten"),
		blockedBy: S.optional(S.array(S.string)),
		diagnostics: S.array(diagnosticShape),
	})
);

export const watchLineShapes = {
	write: S.object({ write: writeEntryShape }),
	notice: S.object({
		notice: S.object({
			kind: S.enum("added", "removed", "broken", "recovered"),
			config: S.string,
			keptLastValid: S.optional(S.boolean),
			diagnostics: S.optional(S.array(diagnosticShape)),
		}),
	}),
	error: S.object({ error: errorShape }),
	diagnostics: S.object({ diagnostics: S.array(diagnosticShape) }),
};

export const agentRulesLineShape = S.object({ agentRules: S.array(S.string) });

export function agentRulesLine(
	refreshed: readonly string[]
): { agentRules: string[] } | undefined {
	return refreshed.length > 0 ? { agentRules: [...refreshed] } : undefined;
}

export const writeLineShape = S.union(
	agentRulesLineShape,
	watchLineShapes.write,
	watchLineShapes.notice,
	watchLineShapes.error,
	watchLineShapes.diagnostics
);

export interface WriteEntry {
	readonly config: string;
	readonly projectFile: string | null;
	readonly outcome: "wrote" | "unchanged" | "wouldWrite" | "notWritten";
	readonly blockedBy?: readonly string[];
	readonly diagnostics: readonly DiagnosticJson[];
}

interface ConfigsDocument {
	readonly changed: boolean;
	readonly configs: readonly WriteEntry[];
}

export function writeEntry(
	outcome: ConfigOutcome,
	cwd: string,
	diagnostics: readonly Diagnostic[] = outcome.diagnostics
): WriteEntry {
	const loaded = outcome.kind !== "notLoaded";
	return {
		config: configPath(cwd, outcome.file),
		projectFile: loaded ? toNative(outcome.config.projectFile) : null,
		outcome:
			isWritten(outcome) || outcome.kind === "wouldWrite"
				? outcome.kind
				: "notWritten",
		...(outcome.kind === "notWritten" && {
			blockedBy: outcome.blockedBy.map((file) => configPath(cwd, file)),
		}),
		diagnostics: diagnostics.map((diagnostic) =>
			diagnosticToJson(diagnostic, cwd)
		),
	};
}

export function configsDocument(
	outcomes: readonly ConfigOutcome[],
	cwd: string,
	diagnosticsOf: (outcome: ConfigOutcome) => readonly Diagnostic[] = (
		outcome
	) => outcome.diagnostics
): ConfigsDocument {
	const configs = outcomes.map((outcome) =>
		writeEntry(outcome, cwd, diagnosticsOf(outcome))
	);
	return {
		changed: configs.some(({ outcome }) => outcome === "wrote"),
		configs,
	};
}

export const writeDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	plainProjects: S.array(S.string),
	agentRules: S.optional(S.array(S.string)),
});

export const isPlain = (outcome: ConfigOutcome): boolean =>
	outcome.kind !== "notLoaded" && outcome.config.isAdopted;

export function writeDocument(
	run: WriteRun,
	cwd: string,
	plainProjects: readonly string[],
	agentRules: readonly string[]
) {
	const left = [
		...run.outcomes.filter(isPlain).map(({ file }) => file),
		...plainProjects,
	];
	return {
		...configsDocument(run.outcomes, cwd),
		plainProjects: [...new Set(left.map((file) => configPath(cwd, file)))],
		...agentRulesLine(agentRules),
	};
}
