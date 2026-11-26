import { ErrorUtils, ReportedError } from "../../base/errors.js";
import { Diagnostic } from "../diagnostics/diagnostic.js";
import { failureToJson } from "../diagnostics/diagnostic-json.js";
import { DiagnosticsPresentation, LogService } from "./log-service.js";

export class JsonLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	result(text: string): void {
		console.info(text);
	}

	failure(error: Error, _command?: string): void {
		if (!(error instanceof ReportedError)) this.crash(error);
	}

	crash(error: unknown): void {
		this.result(
			JSON.stringify(failureToJson(ErrorUtils.fromUnknown(error)))
		);
	}

	error(_message: string | Error, ..._args: unknown[]): void {}
	warn(_message: string, ..._args: unknown[]): void {}
	info(_message: string, ..._args: unknown[]): void {}
	debug(_message: string, ..._args: unknown[]): void {}
	trace(_message: string, ..._args: unknown[]): void {}
	note(_text: string): void {}
	notice(_text: string): void {}
	intro(_title: string): void {}
	step(_title: string): void {}
	success(_message: string): void {}
	outro(_message: string): void {}
	closeFrame(_message: string): void {}
	diagnostics(
		_found: readonly Diagnostic[],
		_how?: DiagnosticsPresentation
	): void {}
}
