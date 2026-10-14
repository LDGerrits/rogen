import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface ProcessExit {
	readonly code: number | null;
	readonly signal: string | null;
	readonly error?: Error;
	/** Ended by Ctrl+C or a termination request: Windows' console sends one to every process on it, elsewhere only this process's own request ends a child. */
	readonly interrupted?: boolean;
}

export interface ProcessOutput {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

export interface SpawnOptions {
	readonly cwd: string;
	/** Variables the program gets, each worked out from what the environment already holds under that name. */
	readonly env?: Readonly<
		Record<string, (inherited: string | undefined) => string>
	>;
}

export interface ExecOptions {
	readonly cwd: string;
	readonly timeout: number;
	readonly signal?: AbortSignal;
}

/** The exit codes of a program that Ctrl+C or a termination request ended: 128 plus the signal on POSIX, `STATUS_CONTROL_C_EXIT` on Windows. */
const INTERRUPTED_CODES: ReadonlySet<number> = new Set([130, 143, 0xc000013a]);
const INTERRUPTING_SIGNALS: ReadonlySet<string> = new Set([
	"SIGINT",
	"SIGTERM",
]);

export const wasInterrupted = ({ code, signal }: ProcessExit): boolean =>
	(signal !== null && INTERRUPTING_SIGNALS.has(signal)) ||
	(code !== null && INTERRUPTED_CODES.has(code));

export const exitCodeText = (code: number): string =>
	code > 0x7fffffff ? `0x${code.toString(16).toUpperCase()}` : String(code);

export interface ChildProcess extends Disposable {
	/** Each line it printed, on either stream, as the line completes; one the process left unfinished comes when it exits. */
	readonly onDidOutputLine: Event<string>;
	readonly onDidExit: Event<ProcessExit>;

	/** Ends the process and every process it started, and resolves once it has exited. Safe to call after it exited. */
	terminate(): Promise<ProcessExit>;
}

export interface ProcessService {
	readonly _serviceBrand: undefined;

	which(command: string): Promise<string | undefined>;
	exec(
		file: string,
		args: readonly string[],
		options: ExecOptions
	): Promise<Result<ProcessOutput, Error>>;
	/** Starts `file`, with no input; what it prints comes through `onDidOutputLine`. */
	spawn(
		file: string,
		args: readonly string[],
		options: SpawnOptions
	): ChildProcess;
}

export const ProcessService =
	createServiceIdentifier<ProcessService>("processService");
