import {
	CancelledError,
	ErrorKinds,
	ErrorUtils,
	errorKind,
} from "../../base/errors.js";
import { DiagnosticsError } from "../diagnostics/diagnostics-error.js";
import { LogService } from "../log/log-service.js";
import { failureToJson } from "../diagnostics/diagnostic-json.js";
import { Result } from "../../base/result.js";
import { exitCodeOfSignal } from "../lifecycle/lifecycle-service.js";
import { ReportedError } from "./commands.js";

/** Tells a failed run as one JSON line a program reads, or as lines for a person. */
export class CommandFailure {
	constructor(
		private readonly logService: LogService,
		private readonly json: boolean
	) {}

	/** Tells the user why the run failed. `command` is the one that failed; without it the failure came before any command ran, so there is no frame to close. */
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
			for (const diagnostic of error.diagnostics) {
				this.logService.diagnostic(diagnostic);
				this.logService.annotate(diagnostic);
			}
		} else {
			this.logService.error(error.message);
		}
		if (command) this.logService.closeFrame(`${command} failed.`);
	}

	/** Keeps `--json`'s one document when the run threw; the stack is still the caller's to print, on stderr. */
	reportCrash(error: unknown): void {
		if (!this.json) return;
		this.logService.print(
			JSON.stringify(failureToJson(ErrorUtils.fromUnknown(error)))
		);
	}
}

/** The exit code of a run that failed with `error`: the one its kind ends with. */
export function exitCodeOf(error: Error): number {
	const cause = error instanceof ReportedError ? error.cause : error;
	return ErrorKinds[errorKind(ErrorUtils.fromUnknown(cause))].exitCode;
}

/** The one place a run's exit code is chosen: commands return a result and never set a number. A shutdown `signal` wins over the outcome, as a shell reports a process the signal stopped. */
export function exitCode(
	outcome: Result<void, Error>,
	signal?: NodeJS.Signals
): number {
	if (signal !== undefined) return exitCodeOfSignal(signal);
	return outcome.isErr() ? exitCodeOf(outcome.error) : 0;
}
