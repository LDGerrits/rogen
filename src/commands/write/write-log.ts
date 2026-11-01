import { relativeTo } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import { ConfigOutcome, WriteRun } from "../../domain/write/write.js";
import { LogService } from "../../platform/log/log-service.js";
import { OutcomeLog } from "../write/outcome-log.js";
import { isPlain } from "./write-document.js";

/** What `rogen write` says: a line for each config and each project file it left alone, then how many it wrote. */
export class WriteLog {
	private readonly outcomeLog: OutcomeLog;

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {
		this.outcomeLog = new OutcomeLog(logService, cwd);
	}

	report(
		run: WriteRun,
		home: string,
		plainProjects: readonly string[]
	): void {
		this.outcomeLog.begin("write", [], home);
		for (const { outcome, warnings, errors } of run.shares) {
			const diagnostics = [...warnings.fresh, ...errors.fresh];
			if (isPlain(outcome)) {
				this.plain(outcome.file);
				this.outcomeLog.diagnostics(diagnostics, outcome.file);
			} else
				this.outcomeLog.outcome(outcome, diagnostics, {
					notes: [
						this.outcomeLog.sameAs("errors", errors.sameAs),
						this.outcomeLog.sameAs("warnings", warnings.sameAs),
					],
				});
		}
		for (const file of plainProjects) this.plain(file);
		const configs = run.outcomes.filter((outcome) => !isPlain(outcome));
		const count = WriteLog.count(configs);
		if (run.failed) this.logService.closeFrame(`${count}.`);
		else this.outcomeLog.end(count, run.warningCount);
	}

	/** How many project files the write wrote, and how many it left as they were. */
	private static count(configs: readonly ConfigOutcome[]): string {
		const wrote = configs.filter(({ kind }) => kind === "wrote").length;
		const unchanged = configs.filter(
			({ kind }) => kind === "unchanged"
		).length;
		if (unchanged > 0 && unchanged === configs.length)
			return `${plural(unchanged, "project file")} unchanged`;
		const count = `Wrote ${wrote} of ${plural(configs.length, "project file")}`;
		return unchanged === 0 ? count : `${count} (${unchanged} unchanged)`;
	}

	private plain(file: string): void {
		this.logService.info(
			`${relativeTo(this.cwd, file)} · plain project, not written`
		);
	}
}
