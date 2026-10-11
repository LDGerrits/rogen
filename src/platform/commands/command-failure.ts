import { CancelledError, ErrorUtils, UsageError } from "../../base/errors.js";
import { DiagnosticsError } from "../diagnostics/diagnostics-error.js";
import { LogService } from "../log/log-service.js";
import { failureToJson } from "../diagnostics/diagnostic-json.js";
import { ExitCodeError, ReportedError } from "./commands.js";

/** How a failed run is told to the user: as the JSON document a program reads, on one line so it also ends a stream of JSON lines, or as lines for a person. */
export class CommandFailure {
	constructor(
		private readonly logService: LogService,
		private readonly json: boolean
	) {}

	/** `command` is the one that failed; without it the failure came before any command ran, so there is no frame to close. */
	report(error: Error, command?: string): void {
		if (error instanceof ReportedError) return;
		if (this.json) {
			this.logService.print(JSON.stringify(failureToJson(error)));
			return;
		}
		if (error instanceof CancelledError) {
			this.logService.closeFrame(error.message);
			return;
		}
		if (error instanceof DiagnosticsError) {
			for (const diagnostic of error.diagnostics)
				this.logService.diagnostic(diagnostic);
		} else {
			this.logService.error(error.message);
		}
		if (command) this.logService.closeFrame(`${command} failed.`);
	}

	/** Tells the user why the run failed, and returns the exit code it ends with. */
	finish(error: Error, command?: string): number {
		this.report(error, command);
		return exitCodeOf(error);
	}

	/** Keeps `--json`'s one document when the run threw; the stack is still the caller's to print, on stderr. */
	reportCrash(error: unknown): void {
		if (!this.json) return;
		this.logService.print(
			JSON.stringify(failureToJson(ErrorUtils.fromUnknown(error)))
		);
	}
}

/** The exit code of a run that failed with `error`: the one it carries, else 2 when the command line is wrong and 1 when the project is. */
export function exitCodeOf(error: Error): number {
	const cause = error instanceof ReportedError ? error.cause : error;
	if (cause instanceof ExitCodeError) return cause.exitCode;
	return cause instanceof UsageError ? 2 : 1;
}
