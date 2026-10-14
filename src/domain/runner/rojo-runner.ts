import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ProcessExit } from "../../platform/process/process-service.js";
import { ServerMessage, SyncServer } from "./sync-server.js";

export interface ServerExecutable {
	readonly server: SyncServer;
	readonly file: string;
	readonly version: string;
}

export interface RojoProcess extends Disposable {
	/** Fired for each message it prints; its own info logs and noise come as `debug`. */
	readonly onDidMessage: Event<ServerMessage>;
	/** Fired for each log record that says a Studio plugin connected or left; none once it has exited. */
	readonly onDidConnection: Event<"opened" | "closed">;
	/** Fired once, after the messages it left unsaid. */
	readonly onDidExit: Event<ProcessExit>;

	/** Ends the process and what it started, and resolves once it has exited. */
	terminate(): Promise<void>;
}

export interface RojoRunner {
	readonly _serviceBrand: undefined;

	/** The Rojo that runs in `directory`: the one a toolchain file there or above pins, else the one on the PATH, checked to start. A failure without a toolchain file to point at is about `resource`. */
	find(
		directory: string,
		resource: string,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, DiagnosticsError>>;

	/** Starts `executable` as `rojo <command> <projectFile> <flags>` in `cwd`; the flags go last, untouched. A command that reads no project, such as `plugin`, has none. */
	start(
		executable: ServerExecutable,
		command: string,
		projectFile: string | undefined,
		flags: readonly string[],
		cwd: string
	): RojoProcess;
}

export const RojoRunner = createServiceIdentifier<RojoRunner>("rojoRunner");
