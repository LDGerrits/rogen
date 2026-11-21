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

export class CommandFailure {
	constructor(
		private readonly json: boolean,
		@LogService private readonly logService: LogService
	) {}

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

	reportCrash(error: unknown): void {
		if (!this.json) return;
		this.logService.print(
			JSON.stringify(failureToJson(ErrorUtils.fromUnknown(error)))
		);
	}
}

export function exitCodeOf(error: Error): number {
	const cause = error instanceof ReportedError ? error.cause : error;
	return ErrorKinds[errorKind(ErrorUtils.fromUnknown(cause))].exitCode;
}

export function exitCode(
	outcome: Result<void, Error>,
	signal?: NodeJS.Signals
): number {
	if (signal !== undefined) return exitCodeOfSignal(signal);
	return outcome.isErr() ? exitCodeOf(outcome.error) : 0;
}
