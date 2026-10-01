import { Diagnostic } from "../diagnostics/diagnostic.js";
import { LogLevel, LogService } from "./log-service.js";

export class NullLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	setLevel(_level: LogLevel): void {}
	error(_message: string | Error, ..._args: unknown[]): void {}
	warn(_message: string, ..._args: unknown[]): void {}
	info(_message: string, ..._args: unknown[]): void {}
	debug(_message: string, ..._args: unknown[]): void {}
	trace(_message: string, ..._args: unknown[]): void {}
	print(_text: string): void {}
	intro(_title: string): void {}
	step(_title: string): void {}
	success(_message: string): void {}
	outro(_message: string): void {}
	closeFrame(_message: string): void {}
	diagnostic(_diagnostic: Diagnostic): void {}
}
