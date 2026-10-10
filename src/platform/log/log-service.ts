import { Diagnostic } from "../diagnostics/diagnostic.js";
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

	error(message: string | Error, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;

	/** Text the user asked for (help, version, JSON), written as is. */
	print(text: string): void;
	/** Text that goes with what `print` wrote, dimmed where the output has colour. */
	note(text: string): void;
	intro(title: string): void;
	step(title: string): void;
	/** A titled block of what the user asked for, drawn as a step with its lines under it, and written at any level but off. */
	section(title: string, body?: string): void;
	success(message: string): void;
	outro(message: string): void;
	/** Closes the frame `intro` opened with `message`; does nothing when none is open. */
	closeFrame(message: string): void;
	/** Written as `file:line:col - severity: message` with no severity prefix of its own, so editors and CI can parse it. A `failing` diagnostic is what made the run fail, so it is written wherever errors are. */
	diagnostic(diagnostic: Diagnostic, options?: { failing?: true }): void;
}

export const LogService = createServiceIdentifier<LogService>("logService");
