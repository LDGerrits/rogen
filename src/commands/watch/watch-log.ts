import path from "path";
import { relativeTo } from "../../base/path.js";
import {
	ConfigNotice,
	RebuildReport,
	WatchCause,
	WatchUpdate,
} from "../../domain/watch/watch-service.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { renderDiagnostic } from "../../platform/diagnostics/render-diagnostic.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-events.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build-log.js";

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
	if (sourceFiles > 0)
		parts.push(
			`${sourceFiles} ${sourceFiles === 1 ? "file" : "files"} changed`
		);
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

	update({ at, cause, changes, notices, reports }: WatchUpdate): void {
		const fresh = notices
			.map((notice) => this.unseenNotice(notice))
			.filter(
				({ errors, warnings }) => errors.length + warnings.length > 0
			);
		const shown = reports.map((report) => this.unseenReport(report));
		// A round whose only news is a config problem already printed has nothing to say.
		if (notices.length > 0 && fresh.length === 0 && shown.length === 0)
			return;

		this.logService.step(`${clockTime(at)} · ${titleOf(cause)}`);
		for (const line of describeFileChanges(changes, this.cwd))
			this.logService.debug(line);
		fresh.forEach((notice) => this.notice(notice));
		shown.forEach((report) => this.report(report));
	}

	private unseenNotice({
		file,
		errors,
		warnings,
	}: ConfigNotice): ConfigNotice {
		const fresh = this.printed.unseen(`${file}#config`, [
			...errors,
			...warnings,
		]);
		return {
			file,
			errors: fresh.filter(isError),
			warnings: fresh.filter((diagnostic) => !isError(diagnostic)),
		};
	}

	/** A report whose diagnostics are only those not printed for its config the last time. */
	private unseenReport(report: RebuildReport): RebuildReport {
		const { file } = report.config;
		return {
			...report,
			diagnostics: [
				...this.printed.unseen(`${file}#build`, report.diagnostics),
				...(report.syncDiagnostics
					? this.printed.unseen(
							`${file}#sync`,
							report.syncDiagnostics
						)
					: []),
			],
		};
	}

	private notice({ file, errors, warnings }: ConfigNotice): void {
		for (const diagnostic of errors) this.logService.diagnostic(diagnostic);
		if (errors.length > 0) {
			this.logService.error(
				`Still building from the last valid ${path.basename(file)}.`
			);
		}
		for (const diagnostic of warnings)
			this.logService.diagnostic(diagnostic);
	}

	private report({
		entry,
		config,
		outcome,
		diagnostics,
		summary,
	}: RebuildReport): void {
		if (outcome === "failed" || !summary) {
			this.buildLog.notWritten(
				{ entry, config },
				diagnostics.length === 0
			);
		} else {
			this.buildLog.written(
				{ entry, config },
				outcome === "wrote",
				summary
			);
		}
		for (const diagnostic of diagnostics)
			this.logService.diagnostic(diagnostic);
	}
}
