import path from "path";
import { configPath } from "../../platform/config/config-path.js";
import { toNative } from "../../base/path.js";
import { Result } from "../../base/result.js";
import { ConfigBuild, isWritten } from "../../domain/build/build.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { RojoCommandRun } from "../../domain/runner/rojo-command-service.js";
import { ServerMessage } from "../../domain/runner/rojo-server.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import {
	DiagnosticJson,
	ErrorJson,
	diagnosticShape,
	diagnosticToJson,
	errorShape,
	failureToJson,
} from "../../platform/diagnostics/diagnostic-json.js";

const S = OutputShape;

export const buildEntryShape = S.named(
	"BuildEntry",
	S.object({
		config: S.string,
		projectFile: S.nullable(S.string),
		outcome: S.enum("wrote", "unchanged", "wouldWrite", "notWritten"),
		blockedBy: S.optional(S.array(S.string)),
		diagnostics: S.array(diagnosticShape),
	})
);

/** What a run of Rojo's `build`, `sourcemap` or `upload` reports: `built` when Rojo ran without an error. */
export const rojoEntryShape = (command: RojoTarget["command"]) =>
	S.named(
		"RojoEntry",
		S.object({
			command: S.enum(command),
			outcome: S.enum("built", "failed", "notRun"),
			project: S.nullable(S.string),
			output: S.optional(S.string),
			plugin: S.optional(S.string),
			messages: S.array(
				S.object({
					severity: S.enum("error", "warning", "info"),
					text: S.string,
				})
			),
			diagnostics: S.optional(S.array(diagnosticShape)),
			error: S.optional(errorShape),
		})
	);

const buildRojoEntryShape = rojoEntryShape("build");

/** The document of `build --json`. */
export const buildDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(buildEntryShape),
	rojo: S.optional(buildRojoEntryShape),
});

/** The lines `build --watch --json` and `serve --json` have in common, each keyed by what it reports. */
export const watchLineShapes = {
	build: S.object({ build: buildEntryShape }),
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

/** One line of `build --watch --json`. */
export const buildLineShape = S.union(
	watchLineShapes.build,
	S.object({ rojo: buildRojoEntryShape }),
	watchLineShapes.notice,
	watchLineShapes.error
);

export interface BuildEntry {
	/** The config file's path relative to the working folder. */
	readonly config: string;
	readonly projectFile: string | null;
	readonly outcome: "wrote" | "unchanged" | "wouldWrite" | "notWritten";
	readonly blockedBy?: readonly string[];
	readonly diagnostics: readonly DiagnosticJson[];
}

/** What `-o` or `-p` asked Rojo to write. */
export interface RojoTarget {
	readonly command: "build" | "sourcemap" | "upload";
	readonly cwd: string;
	readonly output?: string;
	readonly plugin?: string;
}

/** Rojo's build for `-o` or `-p`: `notRun` when the project files had errors, so Rojo had nothing to build. */
export interface RojoEntry {
	readonly command: RojoTarget["command"];
	readonly outcome: "built" | "failed" | "notRun";
	readonly project: string | null;
	/** The absolute path `-o` names. */
	readonly output?: string;
	/** The file name `-p` names. */
	readonly plugin?: string;
	/** What Rojo said, bar its debug output. */
	readonly messages: readonly ServerMessage[];
	readonly diagnostics?: readonly DiagnosticJson[];
	/** Why it failed, when that isn't a diagnostic. */
	readonly error?: ErrorJson;
}

interface BuildDocument {
	/** Whether any project file was written. */
	readonly changed: boolean;
	readonly configs: readonly BuildEntry[];
}

export function buildEntry(
	build: ConfigBuild,
	cwd: string,
	diagnostics: readonly Diagnostic[] = build.diagnostics
): BuildEntry {
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

export function rojoEntry(
	target: RojoTarget,
	ran: Result<RojoCommandRun, Error> | undefined
): RojoEntry {
	const named = {
		command: target.command,
		...(target.output !== undefined && {
			output: toNative(path.resolve(target.cwd, target.output)),
		}),
		...(target.plugin !== undefined && { plugin: target.plugin }),
	};
	if (ran === undefined)
		return { ...named, outcome: "notRun", project: null, messages: [] };
	if (ran.isErr())
		return {
			...named,
			outcome: "failed",
			project: null,
			messages: [],
			...failureToJson(ran.error),
		};
	const { project, messages, failure } = ran.value;
	return {
		...named,
		outcome: failure ? "failed" : "built",
		project: toNative(project.projectFile),
		messages: messages
			.filter(({ severity }) => severity !== "debug")
			.map(({ severity, text }) => ({ severity, text })),
		...(failure && failureToJson(failure)),
	};
}

export function buildDocument(
	builds: readonly ConfigBuild[],
	cwd: string,
	diagnosticsOf: (build: ConfigBuild) => readonly Diagnostic[] = (build) =>
		build.diagnostics
): BuildDocument {
	const configs = builds.map((build) =>
		buildEntry(build, cwd, diagnosticsOf(build))
	);
	return {
		changed: configs.some(({ outcome }) => outcome === "wrote"),
		configs,
	};
}
