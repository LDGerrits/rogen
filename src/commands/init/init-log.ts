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
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build/build-log.js";
import { BuildEntry, buildDocument } from "../build/build-document.js";

const indent = (line: string) => `  ${line}`;

/** The next steps as printed: long-running commands grouped, since each keeps its terminal busy. */
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
				"Have Darklua process your code into the sync dir:",
				...darklua.map(indent),
			]
		: []),
	...edits,
];

/** What a build found, less the sync dir's warnings: the compiler they ask for hasn't run in a project that was just written. */
const foundBy = (build: ConfigBuild): Diagnostic[] => [
	...build.warnings,
	...build.errors,
];

/** How a run of `init` tells what it wrote and built, in lines for a person or as one document for a program. */
export interface InitReporter {
	begin(plan: InitPlan): void;
	written(item: InitWritten): void;
	/** The run failed with `error`; answers with the result the run ends with. */
	failed(error: Error): Result<void, Error>;
	/** Everything was written and built; answers with the result the run ends with. */
	done(plan: InitPlan, run: BuildRun): Result<void, Error>;
}

/** How `init` tells the user what it wrote and built. */
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

	/** The notes the plan carries, set apart from the last answer by a blank gutter line when the run asked. */
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

	/** What the build of each written config said, then the next steps, or that the build failed. */
	done(plan: InitPlan, run: BuildRun): Result<void, Error> {
		for (const build of run.builds)
			this.buildLog.outcome(build, foundBy(build));
		const files = plural(plan.files.length, "file");
		if (run.errors.length > 0) {
			this.logService.outro(
				`Wrote ${files}, but the build failed. Fix the config and run rogen build.`
			);
			return err(new ReportedError(new DiagnosticsError(run.errors)));
		}
		this.logService.step("Next steps");
		for (const line of stepLines(plan.nextSteps))
			this.logService.info(line);
		this.logService.outro(`Wrote ${files}.`);
		return ok(undefined);
	}
}

/** What `--json` prints of a run: what it wrote, kept as it is written, so a failed write still names the files before it. */
export interface InitDocument {
	readonly files: readonly string[];
	readonly appended: readonly string[];
	readonly directories: readonly string[];
	readonly error?: string;
	readonly built?: readonly BuildEntry[];
	readonly notes?: readonly string[];
	readonly nextSteps?: NextSteps;
}

/** Prints what `init` did as one JSON document, naming the files written even when a step failed. */
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
			{ ...this.writtenSoFar(), error: error.message },
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

	/** Prints `document`; a run that failed with `failure` only has its exit code left to set, since the document says what went wrong. */
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
