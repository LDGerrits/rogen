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
	success(message: string): void;
	outro(message: string): void;
	/** Closes the frame `intro` opened with `message`; does nothing when none is open. */
	closeFrame(message: string): void;
	/** Written as `file:line:col - severity: message` with no severity prefix of its own, so editors and CI can parse it. */
	diagnostic(diagnostic: Diagnostic): void;
}

export const LogService = createServiceIdentifier<LogService>("logService");
