import { relativeTo } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import { WriteRun, isWritten } from "../../domain/write/write.js";
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
		const written = configs.filter(isWritten).length;
		const count = `Wrote ${written} of ${plural(configs.length, "project file")}`;
		if (run.failed) this.logService.closeFrame(`${count}.`);
		else
			this.logService.outro(
				run.warningCount === 0
					? `${count}.`
					: `${count} with ${plural(run.warningCount, "warning")}.`
			);
	}

	private plain(file: string): void {
		this.logService.info(
			`${relativeTo(this.cwd, file)} · plain project, not written`
		);
	}
}
