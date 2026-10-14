import path from "path";
import { formatJsonDocument } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import { plural } from "../../base/strings.js";
import { BuildRun, ConfigBuild } from "../../domain/build/build.js";
import {
	InitPlan,
	InitWritten,
	NextSteps,
} from "../../domain/init/init-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ReportedError } from "../../platform/commands/commands.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import {
	ErrorJson,
	errorShape,
	errorToJson,
} from "../../platform/diagnostics/diagnostic-json.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build/build-log.js";
import {
	BuildEntry,
	buildDocument,
	buildEntryShape,
} from "../build/build-document.js";

const S = OutputShape;

/** The document of `init --json`. */
export const initDocumentShape = S.object({
	files: S.array(S.string),
	appended: S.array(S.string),
	directories: S.array(S.string),
	error: S.optional(errorShape),
	built: S.optional(S.array(buildEntryShape)),
	notes: S.optional(S.array(S.string)),
	nextSteps: S.optional(
		S.object({
			setup: S.array(S.string),
			run: S.array(S.string),
			darklua: S.array(S.string),
			edits: S.array(S.string),
		})
	),
});

const indent = (line: string) => `  ${line}`;

const stepLines = ({ setup, run, darklua, edits }: NextSteps): string[] => [
	...setup,
	...(run.length > 0
		? [
				run.length === 1 ? "Run:" : "Run each in its own terminal:",
				...run.map(indent),
			]
		: []),
	...(darklua.length > 0
		? [
				"Have Darklua process your code into the sync path:",
				...darklua.map(indent),
			]
		: []),
	...edits,
];

const foundBy = (build: ConfigBuild): Diagnostic[] => [
	...build.warnings,
	...build.errors,
];

export interface InitReporter {
	begin(plan: InitPlan): void;
	written(item: InitWritten): void;
	failed(error: Error): Result<void, Error>;
	done(plan: InitPlan, run: BuildRun): Result<void, Error>;
}

export class InitLog implements InitReporter {
	private readonly buildLog: BuildLog;

	constructor(
		private readonly logService: LogService,
		cwd: string
	) {
		this.buildLog = new BuildLog(logService, cwd);
	}

	intro(): void {
		this.logService.intro("rogen init");
	}

	begin(plan: InitPlan): void {
		if (plan.asked) this.logService.info("");
		for (const note of plan.notes) this.logService.info(note);
	}

	written(item: InitWritten): void {
		if (item.kind === "directory") {
			this.logService.success(`Created ${item.directory}/.`);
			return;
		}
		const { fileName, addition } = item.file;
		this.logService.success(
			addition !== undefined
				? `Added ${addition} to ${fileName}.`
				: `Created ${fileName}.`
		);
	}

	failed(error: Error): Result<void, Error> {
		return err(error);
	}

	done(plan: InitPlan, run: BuildRun): Result<void, Error> {
		for (const build of run.builds)
			this.buildLog.outcome(build, foundBy(build));
		const files = plural(plan.files.length, "file");
		if (run.errors.length > 0) {
			this.logService.outro(
				`Wrote ${files}, but the build failed. Fix rogen.json and run rogen build.`
			);
			return err(new ReportedError(new DiagnosticsError(run.errors)));
		}
		const steps = stepLines(plan.nextSteps);
		if (steps.length > 0) this.logService.step("Next steps");
		for (const line of steps) this.logService.info(line);
		this.logService.outro(`Wrote ${files}.`);
		return ok(undefined);
	}
}

interface InitDocument {
	readonly files: readonly string[];
	readonly appended: readonly string[];
	readonly directories: readonly string[];
	readonly error?: ErrorJson;
	readonly built?: readonly BuildEntry[];
	readonly notes?: readonly string[];
	readonly nextSteps?: NextSteps;
}

export class InitJsonLog implements InitReporter {
	private readonly files: string[] = [];
	private readonly appended: string[] = [];
	private readonly directories: string[] = [];

	constructor(
		private readonly logService: LogService,
		private readonly directory: string
	) {}

	begin(): void {}

	written(item: InitWritten): void {
		if (item.kind === "directory") {
			this.directories.push(path.join(this.directory, item.directory));
			return;
		}
		const file = path.join(this.directory, item.file.fileName);
		this.files.push(file);
		if (item.file.addition !== undefined) this.appended.push(file);
	}

	failed(error: Error): Result<void, Error> {
		return this.print(
			{ ...this.writtenSoFar(), error: errorToJson(error) },
			error
		);
	}

	done(plan: InitPlan, run: BuildRun): Result<void, Error> {
		return this.print(
			{
				...this.writtenSoFar(),
				built: buildDocument(run.builds, foundBy).configs,
				notes: plan.notes,
				nextSteps: plan.nextSteps,
			},
			DiagnosticsError.of(run.errors)
		);
	}

	private print(
		document: InitDocument,
		failure?: Error
	): Result<void, Error> {
		this.logService.print(formatJsonDocument(document));
		return failure ? err(new ReportedError(failure)) : ok(undefined);
	}

	private writtenSoFar() {
		return {
			files: this.files,
			appended: this.appended,
			directories: this.directories,
		};
	}
}
