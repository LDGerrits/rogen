import { ErrorUtils } from "../../base/errors.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	renderDiagnostic,
} from "../diagnostics/diagnostic.js";
import { diagnosticAnnotationLine } from "../diagnostics/diagnostic-annotation-line.js";
import { defanged } from "../../base/strings.js";
import { Styler, style, unstyled } from "../../base/style.js";
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

/** Diagnostics print relative to `cwd`; annotations are written when `annotationsIn` names the folder their paths are relative to; `color` is off unless given. */
export interface LogServiceOptions {
	readonly cwd?: string;
	readonly annotationsIn?: string;
	readonly color?: boolean;
}

export abstract class AbstractLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	protected level: LogLevel = LogLevel.Info;
	protected stdoutReserved = false;
	protected readonly style: Styler;
	private readonly cwd?: string;
	private readonly annotationsIn?: string;
	private frameOpen = false;
	protected abstract readonly drawsFrame: boolean;

	constructor({ cwd, annotationsIn, color }: LogServiceOptions = {}) {
		this.cwd = cwd;
		this.annotationsIn = annotationsIn;
		this.style = color ? style : unstyled;
	}

	/** Whether a frame is open and drawn, as on a terminal. */
	protected get framed(): boolean {
		return this.drawsFrame && this.frameOpen;
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	reserveStdout(): void {
		this.stdoutReserved = true;
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

	/** Writes `text` with the control characters and workflow commands a file name could put in it made harmless; `print` is the stdout channel, which carries text that is not Rogen's to change, so its callers defang what they print. */
	private emit(kind: LogKind, text: string): void {
		this.write(kind, kind === "print" ? text : defanged(text));
	}

	error(message: string | Error, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Error))
			this.emit("error", this.format(message, args));
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Warn))
			this.emit("warn", this.format(message, args));
	}

	info(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Info))
			this.emit("info", this.format(message, args));
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Debug))
			this.emit("debug", this.format(message, args));
	}

	trace(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Trace))
			this.emit("trace", this.format(message, args));
	}

	print(text: string): void {
		if (this.level !== LogLevel.Off) this.emit("print", text);
	}

	note(text: string): void {
		if (this.level !== LogLevel.Off) this.emit("note", text);
	}

	notice(text: string): void {
		if (this.canLog(LogLevel.Info)) this.emit("notice", text);
	}

	intro(title: string): void {
		if (!this.canLog(LogLevel.Info)) return;
		this.emit("intro", title);
		this.frameOpen = true;
	}

	step(title: string): void {
		if (this.canLog(LogLevel.Info)) this.emit("step", title);
	}

	section(title: string, body?: string): void {
		if (this.level === LogLevel.Off) return;
		this.emit("section", title);
		if (body) this.emit("sectionBody", body);
	}

	success(message: string): void {
		if (this.canLog(LogLevel.Info)) this.emit("success", message);
	}

	outro(message: string): void {
		if (!this.canLog(LogLevel.Info)) return;
		this.emit("outro", message);
		this.frameOpen = false;
	}

	closeFrame(message: string): void {
		if (this.frameOpen) this.outro(message);
	}

	annotate(diagnostic: Diagnostic): void {
		const isError = diagnostic.severity === DiagnosticSeverity.Error;
		if (
			this.annotationsIn === undefined ||
			!this.canLog(isError ? LogLevel.Error : LogLevel.Warn)
		)
			return;
		this.write(
			"annotation",
			diagnosticAnnotationLine(diagnostic, this.annotationsIn)
		);
	}

	/** Colours the severity as the `error:` and `warning:` prefixes are, so the text around it is made harmless first. */
	diagnostic(diagnostic: Diagnostic): void {
		const isError = diagnostic.severity === DiagnosticSeverity.Error;
		if (!this.canLog(isError ? LogLevel.Error : LogLevel.Warn)) return;
		const { resource, message, details } = diagnostic;
		this.write(
			isError ? "diagnosticError" : "diagnosticWarning",
			renderDiagnostic(
				{
					...diagnostic,
					resource: defanged(resource),
					message: defanged(message),
					details: details?.map(defanged),
				},
				this.cwd,
				(label) => this.style(isError ? "red" : "yellow", label)
			)
		);
	}
}
