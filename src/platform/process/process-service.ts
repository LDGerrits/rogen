import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

/** How a process ended: its exit code, or the signal that ended it, or why it never started. */
export interface ProcessExit {
	readonly code: number | null;
	readonly signal: string | null;
	/** Set when the process couldn't be started. */
	readonly error?: Error;
}

/** A process that ran to the end, with what it printed. */
export interface ProcessOutput {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/** Where a started process writes: to this process's own streams, or all of it to stderr, which keeps stdout for this process alone. */
export type ProcessOutputTarget = "inherit" | "stderr";

export interface SpawnOptions {
	readonly cwd: string;
	readonly output: ProcessOutputTarget;
}

/** A process this one started; disposing it ends it. */
export interface ChildProcess extends Disposable {
	/** Fires once, when the process has exited or failed to start. */
	readonly onDidExit: Event<ProcessExit>;

	/** Ends the process and every process it started, and resolves once it has exited. Safe to call after it exited. */
	terminate(): Promise<ProcessExit>;
}

/** Runs other programs. */
export interface ProcessService {
	readonly _serviceBrand: undefined;

	/** The file `command` runs: the first match on the PATH, with the platform's executable extensions; `undefined` when there is none. */
	which(command: string): Promise<string | undefined>;
	/** Runs `file` to the end; fails when it can't start or outlives `timeout` milliseconds. */
	exec(
		file: string,
		args: readonly string[],
		options: { readonly cwd: string; readonly timeout: number }
	): Promise<Result<ProcessOutput, Error>>;
	/** Starts `file`, with no input. */
	spawn(
		file: string,
		args: readonly string[],
		options: SpawnOptions
	): ChildProcess;
}

export const ProcessService =
	createServiceIdentifier<ProcessService>("processService");
