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
import { buildRojoEntryShape } from "./report-rojo.js";

const S = OutputShape;

export const writeEntryShape = S.named(
	"BuildEntry",
	S.object({
		config: S.string,
		projectFile: S.nullable(S.string),
		outcome: S.enum("wrote", "unchanged", "wouldWrite", "notWritten"),
		blockedBy: S.optional(S.array(S.string)),
		diagnostics: S.array(diagnosticShape),
	})
);

/** The lines `build --watch --json` and `serve --json` have in common, each keyed by what it reports. */
export const watchLineShapes = {
	build: S.object({ build: writeEntryShape }),
	notice: S.object({
		notice: S.object({
			kind: S.enum("added", "removed", "broken", "recovered"),
			config: S.string,
			keptLastValid: S.optional(S.boolean),
			diagnostics: S.optional(S.array(diagnosticShape)),
		}),
	}),
	error: S.object({ error: errorShape }),
};

/** One line of `build --watch --json` and `write --watch --json`. */
export const watchLineShape = S.union(
	watchLineShapes.build,
	S.object({ rojo: buildRojoEntryShape }),
	watchLineShapes.notice,
	watchLineShapes.error
);

export interface WriteEntry {
	/** The config file's path relative to the working folder. */
	readonly config: string;
	readonly projectFile: string | null;
	readonly outcome: "wrote" | "unchanged" | "wouldWrite" | "notWritten";
	readonly blockedBy?: readonly string[];
	readonly diagnostics: readonly DiagnosticJson[];
}

interface ConfigsDocument {
	/** Whether any project file was written. */
	readonly changed: boolean;
	readonly configs: readonly WriteEntry[];
}

export function writeEntry(
	build: ConfigOutcome,
	cwd: string,
	diagnostics: readonly Diagnostic[] = build.diagnostics
): WriteEntry {
	const loaded = build.outcome !== "notLoaded";
	return {
		config: configPath(cwd, build.file),
		projectFile: loaded ? toNative(build.config.projectFile) : null,
		outcome:
			isWritten(build) || build.outcome === "wouldWrite"
				? build.outcome
				: "notWritten",
		...(build.outcome === "notWritten" && {
			blockedBy: build.blockedBy.map((file) => configPath(cwd, file)),
		}),
		diagnostics: diagnostics.map(diagnosticToJson),
	};
}

export function configsDocument(
	builds: readonly ConfigOutcome[],
	cwd: string,
	diagnosticsOf: (build: ConfigOutcome) => readonly Diagnostic[] = (build) =>
		build.diagnostics
): ConfigsDocument {
	const configs = builds.map((build) =>
		writeEntry(build, cwd, diagnosticsOf(build))
	);
	return {
		changed: configs.some(({ outcome }) => outcome === "wrote"),
		configs,
	};
}

/** The document of `write --json`. */
export const writeDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	plainProjects: S.array(S.string),
});

/** A project file with no config of its name, which is its own output and is not written. */
export const isPlain = (build: ConfigOutcome): boolean =>
	build.outcome !== "notLoaded" && build.config.isAdopted;

/** The configs document with the project files the run left alone: those named as configs and those beside them, as paths relative to the working folder. */
export function writeDocument(
	run: WriteRun,
	cwd: string,
	plainProjects: readonly string[]
) {
	const left = [
		...run.outcomes.filter(isPlain).map(({ file }) => file),
		...plainProjects,
	];
	return {
		...configsDocument(run.outcomes, cwd),
		plainProjects: [...new Set(left.map((file) => configPath(cwd, file)))],
	};
}
