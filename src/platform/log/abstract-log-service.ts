import { ErrorUtils } from "../../base/errors.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	renderDiagnostic,
} from "../diagnostics/diagnostic.js";
import { diagnosticAnnotationLines } from "../diagnostics/diagnostic-annotation-lines.js";
import { LogLevel, LogService } from "./log-service.js";

export type LogKind =
	| "print"
	| "note"
	| "notice"
	| "intro"
	| "step"
	| "section"
	| "sectionBody"
	| "success"
	| "outro"
	| "info"
	| "warn"
	| "error"
	| "debug"
	| "trace"
	| "diagnosticWarning"
	| "diagnosticError"
	| "annotation";

export abstract class AbstractLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	protected level: LogLevel = LogLevel.Info;
	private frameOpen = false;

	/** Diagnostics print relative to `cwd`; annotations are written when `annotationsIn` names the folder their paths are relative to. */
	constructor(
		private readonly cwd?: string,
		private readonly annotationsIn?: string
	) {}

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

	notice(text: string): void {
		if (this.canLog(LogLevel.Info)) this.write("notice", text);
	}

	intro(title: string): void {
		if (!this.canLog(LogLevel.Info)) return;
		this.write("intro", title);
		this.frameOpen = true;
	}

	step(title: string): void {
		if (this.canLog(LogLevel.Info)) this.write("step", title);
	}

	section(title: string, body?: string): void {
		if (this.level === LogLevel.Off) return;
		this.write("section", title);
		if (body) this.write("sectionBody", body);
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

	annotate(diagnostic: Diagnostic): void {
		if (this.annotationsIn === undefined || this.level === LogLevel.Off)
			return;
		for (const line of diagnosticAnnotationLines(
			diagnostic,
			this.annotationsIn
		))
			this.write("annotation", line);
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
