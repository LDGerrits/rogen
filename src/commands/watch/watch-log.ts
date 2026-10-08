import path from "path";
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
import { ResolvedConfig } from "../../domain/config/config.js";
import { BuildLog, PrintedDiagnostics, joinNotes } from "../build/build-log.js";

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

/** One line per changed file, up to a limit, for `--verbose`. */
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

function titleOf(cause: WatchCause): string {
	switch (cause.kind) {
		case "initial":
			return "initial build";
		case "burst":
			return "many changes · full rebuild";
		case "change":
			return describeChange({
				sourceFiles: cause.sourceFiles,
				configFiles: cause.configFiles.map((file) =>
					path.basename(file)
				),
				reloaded: cause.reloaded,
			});
	}
}

/** `diagnostics` counted with `what` said of them: `3 warnings as before`. */
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

/** How `watch` reports each round of rebuilds. */
export class WatchLog {
	private readonly buildLog: BuildLog;

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {
		this.buildLog = new BuildLog(logService, cwd);
	}

	/** Opens the output: the configs it watches. */
	begin(configs: readonly ResolvedConfig[]): void {
		this.buildLog.begin(
			"watch",
			configs.map(({ label }) => label)
		);
	}

	end(): void {
		this.logService.outro("Stopped watching.");
	}

	update({ at, cause, changes, notices, reports }: WatchUpdate): void {
		if (cause.kind === "burst") {
			this.logService.warn(
				`Threshold reached (${cause.dropped} > ${cause.threshold}). Dropping the buffered changes.`
			);
		}
		this.logService.step(`${clockTime(at)} · ${titleOf(cause)}`);
		for (const line of describeFileChanges(changes, this.cwd))
			this.logService.debug(line);
		notices.forEach((notice) => this.notice(notice));
		// Configs that share a root dir find the same warnings, which one round prints once.
		const printedWarnings = new PrintedDiagnostics(true);
		reports.forEach((report) => this.report(report, printedWarnings));
	}

	private notice(notice: ConfigNotice): void {
		const name = path.basename(notice.file);
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
		printedWarnings: PrintedDiagnostics
	): void {
		const warnings = printedWarnings.take(
			build.label,
			build.config.file,
			unreported.filter((diagnostic) => !isError(diagnostic))
		);
		this.buildLog.outcome(
			build,
			[...warnings.fresh, ...unreported.filter(isError)],
			joinNotes(
				repeatedFailure
					? "same errors as before"
					: counted(repeated, "as before"),
				warnings.repeatNote("warnings"),
				counted(fixed, "fixed")
			)
		);
	}
}
