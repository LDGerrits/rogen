import {
	CancelledError,
	ErrorUtils,
	ReportedError,
} from "../../base/errors.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	renderDiagnostic,
} from "../diagnostics/diagnostic.js";
import { diagnosticAnnotationLine } from "../diagnostics/diagnostic-annotation-line.js";
import { DiagnosticsError } from "../diagnostics/diagnostics-error.js";
import { defanged } from "../../base/strings.js";
import { Styler, style, unstyled } from "../../base/style.js";
import {
	DiagnosticsPresentation,
	LogLevel,
	LogService,
	OutputStream,
} from "./log-service.js";

export type LogKind =
	| "result"
	| "note"
	| "notice"
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
	| "diagnosticError"
	| "annotation";

export interface LogServiceOptions {
	readonly cwd?: string;
	readonly annotationsIn?: string;
	readonly color?: boolean;
	readonly level?: LogLevel;
	readonly ownLines?: OutputStream;
}

export function streamOf(
	kind: LogKind,
	ownLines: OutputStream,
	framed: boolean
): OutputStream {
	switch (kind) {
		case "result":
		case "note":
			return "stdout";
		case "notice":
		case "annotation":
			return "stderr";
		case "intro":
		case "step":
		case "success":
		case "outro":
		case "info":
			return ownLines;
		default:
			return framed ? ownLines : "stderr";
	}
}

export abstract class AbstractLogService implements LogService {
	declare readonly _serviceBrand: undefined;

	protected level: LogLevel;
	protected ownLines: OutputStream;
	protected readonly style: Styler;
	private readonly cwd?: string;
	private readonly annotationsIn?: string;
	private frameOpen = false;
	protected abstract readonly drawsFrame: boolean;

	constructor({
		cwd,
		annotationsIn,
		color,
		level = LogLevel.Info,
		ownLines = "stdout",
	}: LogServiceOptions = {}) {
		this.cwd = cwd;
		this.annotationsIn = annotationsIn;
		this.style = color ? style : unstyled;
		this.level = level;
		this.ownLines = ownLines;
	}

	protected get framed(): boolean {
		return this.drawsFrame && this.frameOpen;
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

	protected abstract write(
		kind: LogKind,
		stream: OutputStream,
		text: string
	): void;

	private emit(kind: LogKind, text: string): void {
		this.put(kind, kind === "result" ? text : defanged(text));
	}

	private put(kind: LogKind, text: string): void {
		this.write(kind, streamOf(kind, this.ownLines, this.framed), text);
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

	result(text: string): void {
		if (this.level !== LogLevel.Off) this.emit("result", text);
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

	diagnostics(
		found: readonly Diagnostic[],
		{ present = (all) => all, asResult }: DiagnosticsPresentation = {}
	): void {
		for (const diagnostic of found) this.annotate(diagnostic);
		for (const diagnostic of present(found))
			if (asResult) this.result(this.rendered(diagnostic));
			else this.diagnostic(diagnostic);
	}

	failure(error: Error, command?: string): void {
		if (error instanceof ReportedError) return;
		if (error instanceof CancelledError) {
			this.closeFrame(error.message);
			return;
		}
		if (error instanceof DiagnosticsError)
			this.diagnostics(error.diagnostics);
		else this.error(error.message);
		if (command) this.closeFrame(`${command} failed.`);
	}

	crash(_error: unknown): void {}

	private annotate(diagnostic: Diagnostic): void {
		if (this.annotationsIn === undefined || !this.shows(diagnostic)) return;
		this.put(
			"annotation",
			diagnosticAnnotationLine(diagnostic, this.annotationsIn)
		);
	}

	private diagnostic(diagnostic: Diagnostic): void {
		if (!this.shows(diagnostic)) return;
		this.put(
			diagnostic.severity === DiagnosticSeverity.Error
				? "diagnosticError"
				: "diagnosticWarning",
			this.rendered(diagnostic)
		);
	}

	private shows({ severity }: Diagnostic): boolean {
		return this.canLog(
			severity === DiagnosticSeverity.Error
				? LogLevel.Error
				: LogLevel.Warn
		);
	}

	private rendered(diagnostic: Diagnostic): string {
		const { resource, message, details, severity } = diagnostic;
		return renderDiagnostic(
			{
				...diagnostic,
				resource: defanged(resource),
				message: defanged(message),
				details: details?.map(defanged),
			},
			this.cwd,
			(label) =>
				this.style(
					severity === DiagnosticSeverity.Error ? "red" : "yellow",
					label
				)
		);
	}
}
