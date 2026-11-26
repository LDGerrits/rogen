import { Diagnostic } from "../diagnostics/diagnostic.js";
import { createDecorator } from "../instantiation/instantiation.js";

export enum LogLevel {
	Off = 0,
	Error = 1,
	Warn = 2,
	Info = 3,
	Debug = 4,
	Trace = 5,
}

export type OutputStream = "stdout" | "stderr";

export interface DiagnosticsPresentation {
	readonly present?: (found: readonly Diagnostic[]) => readonly Diagnostic[];
	readonly asResult?: true;
}

export interface LogService {
	readonly _serviceBrand: undefined;

	error(message: string | Error, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;

	result(text: string): void;
	note(text: string): void;
	notice(text: string): void;
	intro(title: string): void;
	step(title: string): void;
	success(message: string): void;
	outro(message: string): void;
	closeFrame(message: string): void;
	diagnostics(
		found: readonly Diagnostic[],
		how?: DiagnosticsPresentation
	): void;
	failure(error: Error, command?: string): void;
	crash(error: unknown): void;
}

export const LogService = createDecorator<LogService>("logService");
