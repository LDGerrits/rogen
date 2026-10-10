import path from "path";
import { plural } from "../../base/strings.js";
import { BuildRun, ConfigBuild } from "../../domain/build/build.js";
import {
	InitPlan,
	InitWritten,
	NextSteps,
} from "../../domain/init/init-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
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

/** How `init` tells the user what it wrote and built. */
export class InitLog {
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

	built(run: BuildRun): void {
		for (const build of run.builds)
			this.buildLog.outcome(build, foundBy(build));
	}

	/** The closing lines: the next steps, or that the build of what was written failed. */
	end(plan: InitPlan, run: BuildRun): void {
		const files = plural(plan.files.length, "file");
		if (run.errors.length > 0) {
			this.logService.outro(
				`Wrote ${files}, but the build failed. Fix the config and run rogen build.`
			);
			return;
		}
		this.logService.step("Next steps");
		for (const line of stepLines(plan.nextSteps))
			this.logService.info(line);
		this.logService.outro(`Wrote ${files}.`);
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

export class InitJson {
	private readonly files: string[] = [];
	private readonly appended: string[] = [];
	private readonly directories: string[] = [];

	constructor(private readonly directory: string) {}

	add(item: InitWritten): void {
		if (item.kind === "directory") {
			this.directories.push(path.join(this.directory, item.directory));
			return;
		}
		const file = path.join(this.directory, item.file.fileName);
		this.files.push(file);
		if (item.file.addition !== undefined) this.appended.push(file);
	}

	/** The document of a run that failed with `error`. */
	failed(error: Error): InitDocument {
		return { ...this.writtenSoFar(), error: error.message };
	}

	/** The document of a run that wrote everything and built it. */
	done(plan: InitPlan, run: BuildRun): InitDocument {
		return {
			...this.writtenSoFar(),
			built: buildDocument(run.builds, foundBy).configs,
			notes: plan.notes,
			nextSteps: plan.nextSteps,
		};
	}

	private writtenSoFar() {
		return {
			files: this.files,
			appended: this.appended,
			directories: this.directories,
		};
	}
}
