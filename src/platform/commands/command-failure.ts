import {
	CancelledError,
	ReportedError,
	UsageError,
} from "../../base/errors.js";
import { formatJsonDocument } from "../../base/json.js";
import {
	DiagnosticsError,
	failureToJson,
} from "../diagnostics/diagnostics-error.js";
import { LogService } from "../log/log-service.js";

/** How a failed run is told to the user: as the JSON document a program reads, or as lines for a person. */
export class CommandFailure {
	constructor(
		private readonly logService: LogService,
		private readonly json: boolean
	) {}

	/** `command` is the one that failed; without it the failure came before any command ran, so there is no frame to close. */
	report(error: Error, command?: string): void {
		if (error instanceof ReportedError) return;
		if (this.json) {
			this.logService.print(formatJsonDocument(failureToJson(error)));
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
}

/** The exit code of a run that failed with `error`: 2 when the command line is wrong, 1 when the project is. */
export function exitCodeOf(error: Error): number {
	const cause = error instanceof ReportedError ? error.cause : error;
	return cause instanceof UsageError ? 2 : 1;
}
