import { relativeTo } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import {
	RebuildReport,
	WatchCause,
	WatchUpdate,
} from "../../domain/watch/watch-service.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { LogService } from "../../platform/log/log-service.js";
import { ConfigNotice } from "../../domain/config/config-service.js";
import { ResolvedConfig } from "../../domain/config/resolved-config.js";
import { SharedDiagnostics } from "../../domain/build/build.js";
import { toNative } from "../../base/path.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic-json.js";
import { RojoCommandRun } from "../../domain/runner/rojo-command-service.js";
import { Result } from "../../base/result.js";
import { RojoTarget, buildEntry, rojoEntry } from "./build-document.js";
import { reportRojo, reportRojoBesideFailure } from "./report-rojo.js";
import { BuildLog } from "./build-log.js";

interface WatchChange {
	readonly sourceFiles: number;
	readonly configFiles: readonly string[];
	readonly reloaded: boolean;
}

function describeChange({
	sourceFiles,
	configFiles,
	reloaded,
}: WatchChange): string {
	const parts: string[] = [];
	if (sourceFiles > 0) parts.push(`${plural(sourceFiles, "file")} changed`);
	if (configFiles.length > 0) parts.push(`${configFiles.join(", ")} changed`);
	if (reloaded) parts.push("reloaded");
	return parts.join(" · ");
}

function clockTime(date: Date): string {
	return [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map((part) => String(part).padStart(2, "0"))
		.join(":");
}

const CHANGE_VERBS: Record<FileChangeType, string> = {
	[FileChangeType.ADDED]: "added",
	[FileChangeType.UPDATED]: "changed",
	[FileChangeType.DELETED]: "deleted",
};

const LISTED_CHANGES = 20;

function describeFileChanges(
	changes: readonly FileChange[],
	cwd: string
): string[] {
	const hidden = changes.length - LISTED_CHANGES;
	const lines = changes
		.slice(0, LISTED_CHANGES)
		.map(
			(change) =>
				`${CHANGE_VERBS[change.type]} ${relativeTo(cwd, change.path)}`
		);
	return hidden > 0 ? [...lines, `and ${hidden} more`] : lines;
}

function titleOf(cause: WatchCause, cwd: string): string {
	switch (cause.kind) {
		case "initial":
			return "initial build";
		case "burst":
			return "many changes · full rebuild";
		case "change":
			return describeChange({
				sourceFiles: cause.sourceFiles,
				configFiles: cause.configFiles.map((file) =>
					relativeTo(cwd, file)
				),
				reloaded: cause.reloaded,
			});
	}
}

function counted(
	diagnostics: readonly Diagnostic[],
	what: string
): string | undefined {
	const errors = diagnostics.filter(isError).length;
	const warnings = diagnostics.length - errors;
	const parts = [
		...(errors > 0 ? [plural(errors, "error")] : []),
		...(warnings > 0 ? [plural(warnings, "warning")] : []),
	];
	return parts.length > 0 ? `${parts.join(" and ")} ${what}` : undefined;
}

export interface WatchReporter {
	begin(configs: readonly ResolvedConfig[], home?: string): void;
	update(update: WatchUpdate): void;
	error(error: Error): void;
	/** Rojo's build after a write, or why it couldn't run. */
	rojo(ran: Result<RojoCommandRun, Error>, target: RojoTarget): void;
	end(): void;
}

export class WatchLog implements WatchReporter {
	private readonly buildLog: BuildLog;

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string,
		private readonly command = "watch"
	) {
		this.buildLog = new BuildLog(logService, cwd);
	}

	begin(configs: readonly ResolvedConfig[], home?: string): void {
		this.buildLog.begin(
			this.command,
			configs.map(({ label }) => label),
			home
		);
	}

	error(error: Error): void {
		this.logService.error(error.message);
	}

	rojo(ran: Result<RojoCommandRun, Error>): void {
		if (ran.isErr()) this.error(ran.error);
		else if (ran.value.failure) {
			reportRojoBesideFailure(
				this.logService,
				ran.value.messages,
				this.cwd
			);
			this.error(ran.value.failure);
		} else reportRojo(this.logService, ran.value.messages, this.cwd);
	}

	end(message = "Stopped watching."): void {
		this.logService.outro(message);
	}

	update({ at, cause, changes, notices, reports }: WatchUpdate): void {
		if (cause.kind === "burst") {
			this.logService.warn(
				cause.ended
					? `The burst has stopped, after ${plural(cause.dropped, "more change")}.`
					: `Threshold reached (${cause.dropped} > ${cause.threshold}). Dropping the buffered changes.`
			);
		}
		this.logService.step(`${clockTime(at)} · ${titleOf(cause, this.cwd)}`);
		for (const line of describeFileChanges(changes, this.cwd))
			this.logService.debug(line);
		notices.forEach((notice) => this.notice(notice));
		const sharedWarnings = SharedDiagnostics.warnings();
		reports.forEach((report) => this.report(report, sharedWarnings));
	}

	private notice(notice: ConfigNotice): void {
		const name = relativeTo(this.cwd, notice.file);
		switch (notice.kind) {
			case "recovered":
				this.logService.info(`${name} loads again.`);
				return;
			case "added":
				this.logService.info(`${name} added. Building it too.`);
				return;
			case "removed":
				this.logService.info(`${name} removed. No longer building it.`);
				return;
			case "broken":
				this.buildLog.diagnostics(notice.errors);
				this.logService.error(
					notice.keptLastValid
						? `Still building from the last valid ${name}.`
						: `Not building ${name} until it loads.`
				);
				return;
		}
	}

	private report(
		{ build, unreported, repeated, fixed, repeatedFailure }: RebuildReport,
		sharedWarnings: SharedDiagnostics
	): void {
		const warnings = sharedWarnings.take(
			build.label,
			build.file,
			unreported.filter((diagnostic) => !isError(diagnostic))
		);
		this.buildLog.outcome(
			build,
			[...warnings.fresh, ...unreported.filter(isError)],
			{
				notes: [
					repeatedFailure
						? "same errors as before"
						: counted(repeated, "as before"),
					BuildLog.sameAs("warnings", warnings.sameAs),
					counted(fixed, "fixed"),
				],
			}
		);
	}
}

export class WatchJsonLog implements WatchReporter {
	constructor(private readonly logService: LogService) {}

	begin(): void {}

	end(): void {}

	update(update: WatchUpdate): void {
		update.notices.forEach((notice) => this.notice(notice));
		for (const { build } of update.reports)
			this.line({ build: buildEntry(build) });
	}

	error(error: Error): void {
		this.line({ error: error.message });
	}

	rojo(ran: Result<RojoCommandRun, Error>, target: RojoTarget): void {
		this.line({ rojo: rojoEntry(target, ran) });
	}

	line(value: unknown): void {
		this.logService.print(JSON.stringify(value));
	}

	private notice(notice: ConfigNotice): void {
		this.line({
			notice: {
				kind: notice.kind,
				file: toNative(notice.file),
				...(notice.kind === "broken" && {
					keptLastValid: notice.keptLastValid,
					diagnostics: notice.errors.map(diagnosticToJson),
				}),
			},
		});
	}
}
