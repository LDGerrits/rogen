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
	/** A line about the program rather than the run, such as a newer version, on stderr and dimmed where the output has colour; `--quiet` hides it. */
	notice(text: string): void;
	intro(title: string): void;
	step(title: string): void;
	section(title: string, body?: string): void;
	success(message: string): void;
	outro(message: string): void;
	closeFrame(message: string): void;
	/** Written as `file:line:col - severity: message` so editors and CI can parse it; a failing one goes where errors do. */
	diagnostic(diagnostic: Diagnostic, failing?: boolean): void;
	/** Writes GitHub Actions workflow commands on stderr if the run asked for them; takes the diagnostic as the command found it. */
	annotate(diagnostic: Diagnostic): void;
}

export const LogService = createServiceIdentifier<LogService>("logService");
