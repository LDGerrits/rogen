import { Diagnostic } from "../diagnostics/diagnostic.js";
import { LogLevel, LogService } from "./log-service.js";

/** For `--json`: the document on stdout and nothing else, so no line beside it, `--verbose`'s included, can break what a program reads. */
export class JsonLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	print(text: string): void {
		console.info(text);
	}

	setLevel(_level: LogLevel): void {}
	reserveStdout(): void {}
	error(_message: string | Error, ..._args: unknown[]): void {}
	warn(_message: string, ..._args: unknown[]): void {}
	info(_message: string, ..._args: unknown[]): void {}
	debug(_message: string, ..._args: unknown[]): void {}
	trace(_message: string, ..._args: unknown[]): void {}
	note(_text: string): void {}
	notice(_text: string): void {}
	intro(_title: string): void {}
	step(_title: string): void {}
	section(_title: string, _body?: string): void {}
	success(_message: string): void {}
	outro(_message: string): void {}
	closeFrame(_message: string): void {}
	diagnostic(_diagnostic: Diagnostic): void {}
	annotate(_diagnostic: Diagnostic): void {}
}
