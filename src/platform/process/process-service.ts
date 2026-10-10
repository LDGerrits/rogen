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

export interface SpawnOptions {
	readonly cwd: string;
}

/** A process this one started; disposing it ends it. */
export interface ChildProcess extends Disposable {
	/** Text it printed, on either stream, as it arrives. */
	readonly onDidOutput: Event<string>;
	/** Fires once, when the process has exited or failed to start, after the text it printed. */
	readonly onDidExit: Event<ProcessExit>;

	/** Ends the process and every process it started, and resolves once it has exited. Safe to call after it exited. */
	terminate(): Promise<ProcessExit>;
}

/** Runs other programs. */
export interface ProcessService {
	readonly _serviceBrand: undefined;

	/** The file `command` runs: the first match on the PATH, with the platform's executable extensions; `undefined` when there is none. */
	which(command: string): Promise<string | undefined>;
	/** Runs `file` to the end; fails when it can't start, outlives `timeout` milliseconds or is ended through `signal`. */
	exec(
		file: string,
		args: readonly string[],
		options: {
			readonly cwd: string;
			readonly timeout: number;
			readonly signal?: AbortSignal;
		}
	): Promise<Result<ProcessOutput, Error>>;
	/** Starts `file`, with no input; what it prints comes through `onDidOutput`. */
	spawn(
		file: string,
		args: readonly string[],
		options: SpawnOptions
	): ChildProcess;
}

export const ProcessService =
	createServiceIdentifier<ProcessService>("processService");
