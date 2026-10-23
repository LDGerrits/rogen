import { relativeTo } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import { BuildRun, isWritten } from "../../domain/build/build.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build/build-log.js";
import { isPlain } from "./write-document.js";

/** What `rogen write` says: a line for each config and each project file it left alone, then how many it wrote. */
export class WriteLog {
	private readonly buildLog: BuildLog;

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {
		this.buildLog = new BuildLog(logService, cwd);
	}

	report(
		run: BuildRun,
		home: string,
		plainProjects: readonly string[]
	): void {
		this.buildLog.begin("write", [], home);
		for (const { build, warnings, errors } of run.shares) {
			const diagnostics = [...warnings.fresh, ...errors.fresh];
			if (isPlain(build)) {
				this.plain(build.file);
				this.buildLog.diagnostics(diagnostics, build.file);
			} else
				this.buildLog.outcome(build, diagnostics, {
					notes: [
						this.buildLog.sameAs("errors", errors.sameAs),
						this.buildLog.sameAs("warnings", warnings.sameAs),
					],
				});
		}
		for (const file of plainProjects) this.plain(file);
		const configs = run.builds.filter((build) => !isPlain(build));
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
