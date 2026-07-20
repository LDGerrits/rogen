import { LogLevel, LogService } from "./log-service.js";

export class NullLogService implements LogService {
	setLevel(_level: LogLevel): void {}
	getLevel(): LogLevel {
		return LogLevel.Off;
	}
	error(_message: string | Error, ..._args: unknown[]): void {}
	warn(_message: string, ..._args: unknown[]): void {}
	info(_message: string, ..._args: unknown[]): void {}
	debug(_message: string, ..._args: unknown[]): void {}
	trace(_message: string, ..._args: unknown[]): void {}
}
