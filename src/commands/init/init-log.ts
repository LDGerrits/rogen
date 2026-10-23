import path from "path";
import { formatJsonDocument } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import { toPosix, toShellWord } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import { WriteRun, ConfigOutcome } from "../../domain/write/write.js";
import {
	InitDecision,
	InitPlan,
	InitWritten,
	NextSteps,
} from "../../domain/init/init-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ReportedError } from "../../platform/commands/commands.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import {
	DiagnosticJson,
	ErrorJson,
	diagnosticShape,
	diagnosticToJson,
	errorShape,
	errorToJson,
} from "../../platform/diagnostics/diagnostic-json.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { LogService } from "../../platform/log/log-service.js";
import { OutcomeLog } from "../write/outcome-log.js";
import {
	WriteEntry,
	configsDocument,
	writeEntryShape,
} from "../write/write-document.js";

const S = OutputShape;

/** The document of `init --json`. */
export const initDocumentShape = S.object({
	changed: S.boolean,
	dryRun: S.optional(S.boolean),
	files: S.array(
		S.object({
			file: S.string,
			outcome: S.enum("wrote", "wouldWrite"),
			appended: S.optional(S.boolean),
		})
	),
	directories: S.array(S.string),
	git: S.optional(S.enum("initialised", "wouldInitialise", "failed")),
	commands: S.optional(
		S.array(
			S.object({
				command: S.string,
				outcome: S.enum("ran", "wouldRun", "failed", "skipped"),
				error: S.optional(S.string),
			})
		)
	),
	decided: S.optional(
		S.array(
			S.object({
				question: S.string,
				value: S.union(S.string, S.boolean, S.array(S.string)),
				flag: S.string,
			})
		)
	),
	error: S.optional(errorShape),
	built: S.optional(S.array(writeEntryShape)),
	notes: S.optional(S.array(S.string)),
	warnings: S.optional(S.array(diagnosticShape)),
	nextSteps: S.optional(
		S.object({
			directory: S.optional(S.string),
			setup: S.array(S.string),
			run: S.array(S.string),
			edits: S.array(S.string),
		})
	),
});

/** A choice as the flags that make it, so the line can be copied: `--no-darklua`, `--route server --route client`. */
function flagsOf({ question, value, flag }: InitDecision): string[] {
	if (question === "skipGit") return value === true ? [flag] : [];
	if (typeof value === "boolean")
		return [value ? flag : flag.replace("--", "--no-")];
	if (typeof value === "string") return [`${flag} ${value}`];
	return value.length === 0
		? [`${flag} none`]
		: value.map((item) => `${flag} ${item}`);
}

/** The tool that scaffolds the project is reported as the command it is. */
const asCommand = (
	written: InitWritten
): Exclude<InitWritten, { kind: "scaffold" }> =>
	written.kind === "scaffold"
		? { kind: "command", command: written.scaffold.command }
		: written;

const indent = (line: string) => `  ${line}`;

const STUDIO_STEP = "In Studio, press Connect in the Rojo plugin.";

const stepLines = ({ directory, setup, run, edits }: NextSteps): string[] => [
	...(directory !== undefined
		? [
				"In each terminal, start in the project folder:",
				indent(`cd ${toShellWord(directory)}`),
			]
		: []),
	...setup,
	...(run.length > 0
		? [
				run.length === 1 ? "Run:" : "Run each in its own terminal:",
				...run.flatMap((step) => step.split("\n").map(indent)),
			]
		: []),
	...(run.some((line) => line.startsWith("rogen serve"))
		? [STUDIO_STEP]
		: []),
	...edits,
];

const foundBy = (build: ConfigOutcome): Diagnostic[] => [
	...build.warnings,
	...build.errors,
];

const warningsOf = (plan: InitPlan) =>
	plan.warnings.length > 0
		? { warnings: plan.warnings.map(diagnosticToJson) }
		: {};

export interface InitReporter {
	begin(plan: InitPlan): void;
	written(item: InitWritten): void;
	failed(error: Error): Result<void, Error>;
	done(plan: InitPlan, run: WriteRun): Result<void, Error>;
	/** The end of a dry run, which `written` told what it would write. */
	planned(plan: InitPlan): Result<void, Error>;
}

export class InitLog implements InitReporter {
	private readonly outcomeLog: OutcomeLog;
	/** Where the plan's folder lies from the folder the user ran in, which its file names are shown after. */
	private within = "";

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string,
		private readonly dryRun = false
	) {
		this.outcomeLog = new OutcomeLog(logService, cwd);
	}

	private shown(name: string): string {
		return this.within ? path.posix.join(this.within, name) : name;
	}

	intro(): void {
		this.logService.intro("rogen init");
	}

	begin(plan: InitPlan): void {
		this.within = toPosix(path.relative(this.cwd, plan.directory));
		if (plan.asked) this.logService.info("");
		for (const note of plan.notes) this.logService.info(note);
		for (const warning of plan.warnings)
			this.logService.diagnostic(warning);
		if (plan.decided.length > 0)
			this.logService.info(
				`Took the defaults: ${plan.decided.flatMap(flagsOf).join(", ")}.`
			);
	}

	written(written: InitWritten): void {
		const item = asCommand(written);
		const would = this.dryRun ? "Would create" : "Created";
		if (item.kind === "git" && item.failed !== undefined) {
			this.logService.warn(
				`git init failed (${item.failed}), so the project has no repository. Run it yourself, or pass --skip-git.`
			);
			return;
		}
		if (item.kind === "git") {
			this.logService.success(
				`${this.dryRun ? "Would initialise" : "Initialised"} a git repository.`
			);
			return;
		}
		if (item.kind === "directory") {
			this.logService.success(`${would} ${this.shown(item.directory)}/.`);
			return;
		}
		if (item.kind === "command") {
			if (item.failed === undefined) {
				this.logService.success(
					`${this.dryRun ? "Would run" : "Ran"} ${item.command.command}.`
				);
				return;
			}
			const left = [item.command, ...(item.skipped ?? [])].map(
				({ command }) => command
			);
			this.logService.warn(
				`${item.command.command} failed (${item.failed}). Run ${left.length === 1 ? "it" : "these"} yourself: ${left.join(", then ")}.`
			);
			return;
		}
		const { fileName, addition } = item.file;
		this.logService.success(
			addition !== undefined
				? `${this.dryRun ? "Would add" : "Added"} ${addition} to ${this.shown(fileName)}.`
				: `${would} ${this.shown(fileName)}.`
		);
	}

	failed(error: Error): Result<void, Error> {
		return err(error);
	}

	planned(plan: InitPlan): Result<void, Error> {
		this.logService.outro(
			`Would write ${plural(plan.files.length, "file")}. Nothing was written.`
		);
		return ok(undefined);
	}

	done(plan: InitPlan, run: WriteRun): Result<void, Error> {
		for (const build of run.outcomes)
			this.outcomeLog.outcome(build, foundBy(build));
		const files = plural(plan.files.length, "file");
		if (run.errors.length > 0) {
			this.logService.outro(
				`Wrote ${files}, but the build failed.${
					plan.liftedFrom
						? ` ${plan.liftedFrom} is as it was, so Rojo still reads it.`
						: ""
				} Fix default.rogen.json and run rogen write.`
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

interface InitFile {
	readonly file: string;
	readonly outcome: "wrote" | "wouldWrite";
	/** Set when the file existed and something was added to it. */
	readonly appended?: true;
}

interface InitDocument {
	readonly changed: boolean;
	readonly dryRun?: true;
	readonly files: readonly InitFile[];
	readonly directories: readonly string[];
	readonly git?: "initialised" | "wouldInitialise" | "failed";
	readonly commands?: readonly {
		readonly command: string;
		readonly outcome: "ran" | "wouldRun" | "failed" | "skipped";
		readonly error?: string;
	}[];
	readonly decided?: readonly InitDecision[];
	readonly error?: ErrorJson;
	readonly built?: readonly WriteEntry[];
	readonly notes?: readonly string[];
	readonly warnings?: readonly DiagnosticJson[];
	readonly nextSteps?: NextSteps;
}

export class InitJsonLog implements InitReporter {
	private readonly files: InitFile[] = [];
	private readonly directories: string[] = [];
	private decided: readonly InitDecision[] = [];
	private git: "initialised" | "wouldInitialise" | "failed" | undefined;
	private readonly commands: NonNullable<InitDocument["commands"]>[number][] =
		[];

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string,
		private readonly directory: string,
		private readonly dryRun = false
	) {}

	begin(plan: InitPlan): void {
		this.decided = plan.decided;
	}

	written(written: InitWritten): void {
		const item = asCommand(written);
		if (item.kind === "git") {
			this.git =
				item.failed !== undefined
					? "failed"
					: this.dryRun
						? "wouldInitialise"
						: "initialised";
			return;
		}
		if (item.kind === "directory") {
			this.directories.push(path.join(this.directory, item.directory));
			return;
		}
		if (item.kind === "command") {
			this.commands.push({
				command: item.command.command,
				outcome:
					item.failed !== undefined
						? "failed"
						: this.dryRun
							? "wouldRun"
							: "ran",
				...(item.failed !== undefined && { error: item.failed }),
			});
			for (const skipped of item.skipped ?? [])
				this.commands.push({
					command: skipped.command,
					outcome: "skipped",
				});
			return;
		}
		this.files.push({
			file: path.join(this.directory, item.file.fileName),
			outcome: this.dryRun ? "wouldWrite" : "wrote",
			...(item.file.addition !== undefined && {
				appended: true as const,
			}),
		});
	}

	failed(error: Error): Result<void, Error> {
		return this.print(
			{ ...this.writtenSoFar(), error: errorToJson(error) },
			error
		);
	}

	planned(plan: InitPlan): Result<void, Error> {
		return this.print({
			...this.writtenSoFar(),
			notes: plan.notes,
			...warningsOf(plan),
			nextSteps: plan.nextSteps,
		});
	}

	done(plan: InitPlan, run: WriteRun): Result<void, Error> {
		const built = configsDocument(run.outcomes, this.cwd, foundBy);
		const written = this.writtenSoFar();
		return this.print(
			{
				...written,
				changed: written.changed || built.changed,
				built: built.configs,
				notes: plan.notes,
				...warningsOf(plan),
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
			changed:
				!this.dryRun &&
				(this.files.length + this.directories.length > 0 ||
					this.git === "initialised" ||
					this.commands.some(({ outcome }) => outcome === "ran")),
			...(this.dryRun && { dryRun: true as const }),
			files: this.files,
			directories: this.directories,
			...(this.git && { git: this.git }),
			...(this.commands.length > 0 && { commands: this.commands }),
			...(this.decided.length > 0 && { decided: this.decided }),
		};
	}
}
