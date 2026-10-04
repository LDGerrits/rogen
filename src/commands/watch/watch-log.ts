import path from "path";
import { relativeTo } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import {
	RebuildReport,
	WatchCause,
	WatchUpdate,
} from "../../domain/watch/watch-service.js";
import {
	Diagnostic,
	isError,
	renderDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	ConfigNotice,
	ConfigSelection,
	buildableConfig,
} from "../../domain/config/config-service.js";
import { BuildLog } from "../build/build-log.js";

/** A rebuild as this round shows it: only what wasn't printed before. */
interface ShownReport {
	readonly report: RebuildReport;
	readonly diagnostics: readonly Diagnostic[];
	readonly note?: string;
}

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

/** Remembers what was last printed per key, so a rebuild reports only what is new. */
class PrintedDiagnostics {
	private readonly printed = new Map<string, ReadonlySet<string>>();

	/** Returns the diagnostics not printed for `key` last time, and records `diagnostics` as printed. */
	unseen(key: string, diagnostics: readonly Diagnostic[]): Diagnostic[] {
		const previous = this.printed.get(key);
		const rendered = diagnostics.map((diagnostic) =>
			renderDiagnostic(diagnostic)
		);
		this.printed.set(key, new Set(rendered));
		return diagnostics.filter(
			(_, index) => !previous?.has(rendered[index])
		);
	}
}

/** How `watch` reports each round of rebuilds. */
export class WatchLog {
	private readonly buildLog: BuildLog;
	private readonly printed = new PrintedDiagnostics();

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {
		this.buildLog = new BuildLog(logService, cwd);
	}

	/** Opens the output: the configs it watches and the ones it leaves out. */
	begin({ entries, unselected }: ConfigSelection): void {
		this.buildLog.begin(
			"watch",
			entries.flatMap((entry) => buildableConfig(entry) ?? []),
			unselected
		);
	}

	end(): void {
		this.logService.outro("Stopped watching.");
	}

	update({ at, cause, changes, notices, reports }: WatchUpdate): void {
		const shown = reports.map((report) => this.unseenReport(report));

		if (cause.kind === "burst") {
			this.logService.warn(
				`Threshold reached (${cause.dropped} > ${cause.threshold}). Dropping the buffered changes.`
			);
		}
		this.logService.step(`${clockTime(at)} · ${titleOf(cause)}`);
		for (const line of describeFileChanges(changes, this.cwd))
			this.logService.debug(line);
		notices.forEach((notice) => this.notice(notice));
		shown.forEach((report) => this.report(report));
	}

	/** A report with only the diagnostics not printed for its config the last time. */
	private unseenReport(report: RebuildReport): ShownReport {
		const { file } = report.config;
		const build = this.printed.unseen(`${file}#build`, [
			...report.warnings,
			...report.errors,
		]);
		const sync = report.checkedSyncDir
			? this.printed.unseen(`${file}#sync`, report.syncWarnings)
			: [];
		const repeated = report.errors.length > 0 && !build.some(isError);
		return {
			report,
			diagnostics: [...build, ...sync],
			...(repeated && { note: "same errors as before" }),
		};
	}

	private notice({ file, errors }: ConfigNotice): void {
		this.buildLog.diagnostics(errors);
		this.logService.error(
			`Still building from the last valid ${path.basename(file)}.`
		);
	}

	private report({ report, diagnostics, note }: ShownReport): void {
		this.buildLog.outcome(report, diagnostics, note);
	}
}
