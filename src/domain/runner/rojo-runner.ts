import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createDecorator } from "../../platform/instantiation/instantiation.js";
import {
	ProcessExit,
	exitCodeText,
} from "../../platform/process/process-service.js";
import { ServerMessage } from "./rojo-server.js";

export interface ServerExecutable {
	readonly file: string;
	readonly version: string;
}

export interface RojoProcess extends Disposable {
	readonly pid: number | undefined;
	readonly onDidMessage: Event<ServerMessage>;
	readonly onDidConnection: Event<"opened" | "closed">;
	readonly onDidExit: Event<ProcessExit>;

	terminate(): Promise<void>;
}

export interface RojoRestartEvent {
	readonly exit: ProcessExit;
	readonly lines: readonly string[];
}

export interface SupervisedExitEvent {
	readonly exit: ProcessExit;
	readonly gaveUp?: readonly string[];
}

export interface SupervisedRojoOptions {
	readonly beforeRestart?: () => Promise<void>;
	readonly confirmServed?: () => Promise<boolean>;
}

export interface SupervisedRojoProcess extends Disposable {
	readonly pid: number | undefined;
	readonly onDidMessage: Event<ServerMessage>;
	readonly onDidConnection: Event<"opened" | "closed">;
	readonly onDidRestart: Event<RojoRestartEvent>;
	readonly onDidExit: Event<SupervisedExitEvent>;

	markReady(): boolean;
	terminate(): Promise<void>;
}

export function exitHow(exit: ProcessExit): string {
	if (exit.error) return exit.error.message;
	return exit.code === null
		? `signal ${exit.signal}`
		: `exit code ${exitCodeText(exit.code)}`;
}

export function crashedAgain(
	doing: string,
	file: string,
	exit: ProcessExit,
	lines: readonly string[]
): Diagnostic {
	const stopped = `Rojo crashed again right after a restart, so Rogen stopped ${doing}`;
	return lines.length > 0
		? {
				...errorDiagnostic(
					"rojo.crashed",
					{ resource: file },
					`${stopped}:`
				),
				details: lines,
			}
		: errorDiagnostic(
				"rojo.crashed",
				{ resource: file },
				`${stopped} (${exitHow(exit)}).`
			);
}

export interface RojoRunner {
	readonly _serviceBrand: undefined;

	find(
		directory: string,
		resource: string,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, DiagnosticsError>>;

	isRunning(pid: number): boolean;

	terminateTree(pid: number): Promise<void>;

	start(
		executable: ServerExecutable,
		command: string,
		projectFile: string | undefined,
		flags: readonly string[],
		cwd: string,
		keepStdoutWhenQuiet?: boolean
	): RojoProcess;

	supervise(
		start: () => RojoProcess,
		options?: SupervisedRojoOptions
	): SupervisedRojoProcess;
}

export const RojoRunner = createDecorator<RojoRunner>("rojoRunner");
