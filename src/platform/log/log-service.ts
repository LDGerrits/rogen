import { ErrorUtils } from "../../base/errors.js";
import { Diagnostic, DiagnosticSeverity } from "../diagnostics/diagnostic.js";
import { renderDiagnostic } from "../diagnostics/render-diagnostic.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export enum LogLevel {
	Off = 0,
	Error = 1,
	Warn = 2,
	Info = 3,
	Debug = 4,
	Trace = 5,
}

export interface LogService {
	readonly _serviceBrand: undefined;

	setLevel(level: LogLevel): void;
	getLevel(): LogLevel;

	error(message: string | Error, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;

	/** Text the user asked for (help, version, JSON), written as is. */
	print(text: string): void;
	intro(title: string): void;
	step(title: string): void;
	success(message: string): void;
	outro(message: string): void;
	/** Written as `file:line:col - severity: message` with no severity prefix of its own, so editors and CI can parse it. */
	diagnostic(diagnostic: Diagnostic): void;
}

export type LogKind =
	| "print"
	| "intro"
	| "step"
	| "success"
	| "outro"
	| "info"
	| "warn"
	| "error"
	| "debug"
	| "trace"
	| "diagnosticWarning"
	| "diagnosticError";

export const LogService = createServiceIdentifier<LogService>("logService");

export abstract class AbstractLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	protected level: LogLevel = LogLevel.Info;

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	getLevel(): LogLevel {
		return this.level;
	}

	protected canLog(level: LogLevel): boolean {
		return this.level !== LogLevel.Off && this.level >= level;
	}

	protected format(message: string | Error, args: unknown[]): string {
		let result =
			message instanceof Error ? this.formatError(message) : message;

		for (const arg of args) {
			if (arg instanceof Error) {
				result += " " + this.formatError(arg);
			} else if (typeof arg === "object") {
				try {
					result += " " + JSON.stringify(arg);
				} catch {
					result += " [Unserializable Object]";
				}
			} else {
				result += " " + arg;
			}
		}
		return result;
	}

	// Walks the cause chain so wrapped errors aren't silently dropped.
	private formatError(error: Error): string {
		const parts = [error.stack || error.message];
		const seen = new Set<unknown>([error]);

		let cause = error.cause;
		while (cause !== undefined) {
			if (seen.has(cause)) {
				parts.push("Caused by: [circular]");
				break;
			}
			seen.add(cause);

			const causeError = ErrorUtils.fromUnknown(cause);
			parts.push(`Caused by: ${causeError.stack || causeError.message}`);
			cause = causeError.cause;
		}

		return parts.join("\n");
	}

	protected abstract write(kind: LogKind, text: string): void;

	error(message: string | Error, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Error))
			this.write("error", this.format(message, args));
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Warn))
			this.write("warn", this.format(message, args));
	}

	info(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Info))
			this.write("info", this.format(message, args));
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Debug))
			this.write("debug", this.format(message, args));
	}

	trace(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Trace))
			this.write("trace", this.format(message, args));
	}

	print(text: string): void {
		if (this.canLog(LogLevel.Info)) this.write("print", text);
	}

	intro(title: string): void {
		if (this.canLog(LogLevel.Info)) this.write("intro", title);
	}

	step(title: string): void {
		if (this.canLog(LogLevel.Info)) this.write("step", title);
	}

	success(message: string): void {
		if (this.canLog(LogLevel.Info)) this.write("success", message);
	}

	outro(message: string): void {
		if (this.canLog(LogLevel.Info)) this.write("outro", message);
	}

	diagnostic(diagnostic: Diagnostic): void {
		const isError = diagnostic.severity === DiagnosticSeverity.Error;
		if (this.canLog(isError ? LogLevel.Error : LogLevel.Warn))
			this.write(
				isError ? "diagnosticError" : "diagnosticWarning",
				renderDiagnostic(diagnostic)
			);
	}
}

export class NullLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	setLevel(_level: LogLevel): void {}
	getLevel(): LogLevel {
		return LogLevel.Off;
	}
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
	diagnostic(_diagnostic: Diagnostic): void {}
}
