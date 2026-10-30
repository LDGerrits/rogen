import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
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
	/** Its process id, which leads a group of its own; none when it couldn't start. */
	readonly pid: number | undefined;
	/** Fired for each message it prints; its own info logs and noise come as `debug`. */
	readonly onDidMessage: Event<ServerMessage>;
	/** Fired for each log record that says a Studio plugin connected or left; none once it has exited. */
	readonly onDidConnection: Event<"opened" | "closed">;
	/** Fired once, after the messages it left unsaid. */
	readonly onDidExit: Event<ProcessExit>;

	/** Ends the process and what it started, and resolves once it has exited. */
	terminate(): Promise<void>;
}

/** Rojo crashed while it served, and another started in its place. */
export interface RojoRestartEvent {
	readonly exit: ProcessExit;
	/** What Rojo printed about the crash. */
	readonly lines: readonly string[];
}

/** The supervised Rojo stopped for good. */
export interface SupervisedExitEvent {
	readonly exit: ProcessExit;
	/** Set when a restarted Rojo crashed again right away, so no other was started: what it printed about the crash. */
	readonly gaveUp?: readonly string[];
}

export interface SupervisedRojoOptions {
	/** Runs before each restart, as a fresh write of the project file Rojo reads. */
	readonly beforeRestart?: () => Promise<void>;
}

/** A Rojo that is started again when it crashes, until it crashes back to back. A crash is an exit with a non-zero code that nobody asked for, of a Rojo that served. */
export interface SupervisedRojoProcess extends Disposable {
	/** The id of the current Rojo's process. */
	readonly pid: number | undefined;
	/** What the current Rojo says; the lines of a crash come as `debug`. */
	readonly onDidMessage: Event<ServerMessage>;
	readonly onDidConnection: Event<"opened" | "closed">;
	/** Fired once the Rojo that replaces a crashed one has started. */
	readonly onDidRestart: Event<RojoRestartEvent>;
	/** Fired once, when a Rojo stops and none is started in its place. */
	readonly onDidExit: Event<SupervisedExitEvent>;

	/** Marks the current Rojo as serving, so a crash from now on is one to restart from. */
	markReady(): void;
	/** Ends the current Rojo, and starts no other. */
	terminate(): Promise<void>;
}

/** How a Rojo process ended, as a failure says it, such as `exit code 1`. */
export function exitHow(exit: ProcessExit): string {
	if (exit.error) return exit.error.message;
	return exit.code === null
		? `signal ${exit.signal}`
		: `exit code ${exitCodeText(exit.code)}`;
}

/** Why Rogen stopped `doing`, such as `serving Game`, after a restarted Rojo crashed again: with the lines Rojo printed about it, else with how it exited. */
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

	/** The Rojo that runs in `directory`: the one a toolchain file there or above pins, else the one on the PATH, checked to start. A failure without a toolchain file to point at is about `resource`. */
	find(
		directory: string,
		resource: string,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, DiagnosticsError>>;

	/** Whether a process with this id exists, such as the `rogen serve` that wrote a server record. */
	isRunning(pid: number): boolean;

	/** Ends a server an earlier run left, the process of this id and what it started, and resolves once they are gone. */
	terminateTree(pid: number): Promise<void>;

	/** Starts `executable` as `rojo <command> <projectFile> <flags>` in `cwd`; the flags go last, untouched. A command that reads no project, such as `plugin`, has none. `keepStdoutWhenQuiet` keeps what it prints on stdout under `--quiet` too. */
	start(
		executable: ServerExecutable,
		command: string,
		projectFile: string | undefined,
		flags: readonly string[],
		cwd: string,
		keepStdoutWhenQuiet?: boolean
	): RojoProcess;

	/** Starts a Rojo with `start`, and again with it whenever that Rojo crashes. */
	supervise(
		start: () => RojoProcess,
		options?: SupervisedRojoOptions
	): SupervisedRojoProcess;
}

export const RojoRunner = createServiceIdentifier<RojoRunner>("rojoRunner");
