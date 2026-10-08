import { ErrorUtils } from "../../base/errors.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	renderDiagnostic,
} from "../diagnostics/diagnostic.js";
import { LogLevel, LogService } from "./log-service.js";

export type LogKind =
	| "print"
	| "note"
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

export abstract class AbstractLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	protected level: LogLevel = LogLevel.Info;
	private frameOpen = false;

	/** Diagnostics are written relative to `cwd` when one is given. */
	constructor(private readonly cwd?: string) {}

	setLevel(level: LogLevel): void {
		this.level = level;
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
		if (this.level !== LogLevel.Off) this.write("print", text);
	}

	note(text: string): void {
		if (this.level !== LogLevel.Off) this.write("note", text);
	}

	intro(title: string): void {
		if (!this.canLog(LogLevel.Info)) return;
		this.write("intro", title);
		this.frameOpen = true;
	}

	step(title: string): void {
		if (this.canLog(LogLevel.Info)) this.write("step", title);
	}

	success(message: string): void {
		if (this.canLog(LogLevel.Info)) this.write("success", message);
	}

	outro(message: string): void {
		if (!this.canLog(LogLevel.Info)) return;
		this.write("outro", message);
		this.frameOpen = false;
	}

	closeFrame(message: string): void {
		if (this.frameOpen) this.outro(message);
	}

	diagnostic(diagnostic: Diagnostic): void {
		const isError = diagnostic.severity === DiagnosticSeverity.Error;
		if (this.canLog(isError ? LogLevel.Error : LogLevel.Warn))
			this.write(
				isError ? "diagnosticError" : "diagnosticWarning",
				renderDiagnostic(diagnostic, this.cwd)
			);
	}
}
