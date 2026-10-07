import path from "path";
import { relativeTo } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import {
	RebuildReport,
	WatchCause,
	WatchUpdate,
} from "../../domain/watch/watch-service.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { LogService } from "../../platform/log/log-service.js";
import { ConfigNotice } from "../../domain/config/config-service.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import { BuildLog } from "../build/build-log.js";

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
		this.buildLog.begin("watch", configs);
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
		reports.forEach((report) => this.report(report));
	}

	private notice(notice: ConfigNotice): void {
		const name = path.basename(notice.file);
		if (notice.kind === "recovered") {
			this.logService.info(`${name} loads again.`);
			return;
		}
		this.buildLog.diagnostics(notice.errors);
		this.logService.error(`Still building from the last valid ${name}.`);
	}

	private report({
		build,
		unreported,
		repeatedFailure,
	}: RebuildReport): void {
		this.buildLog.outcome(
			build,
			unreported,
			repeatedFailure ? "same errors as before" : undefined
		);
	}
}
