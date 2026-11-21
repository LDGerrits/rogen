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

export interface LogService {
	readonly _serviceBrand: undefined;

	setLevel(level: LogLevel): void;

	sendOwnLinesToStderr(): void;

	error(message: string | Error, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;

	print(text: string): void;
	note(text: string): void;
	notice(text: string): void;
	intro(title: string): void;
	step(title: string): void;
	section(title: string, body?: string): void;
	success(message: string): void;
	outro(message: string): void;
	closeFrame(message: string): void;
	diagnostic(diagnostic: Diagnostic): void;
	annotate(diagnostic: Diagnostic): void;
}

export const LogService = createDecorator<LogService>("logService");
