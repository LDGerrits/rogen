import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ProcessExit } from "../../platform/process/process-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ReloadableSelection } from "../config/config-service.js";
import { WatchUpdate } from "../watch/watch-service.js";
import { ServerExecutable } from "../runner/rojo-runner.js";
import { ServerInfo, ServerMessage } from "../runner/rojo-server.js";
import { ServeAddress } from "./serve.js";

export interface ServeRequest {
	/** The config to serve, by folder or project file path; the one here when none. */
	readonly refs: readonly string[];
	/** Passed to the server after the project file, untouched. */
	readonly serverArgs: readonly string[];
	/** Aborts the checks that run other programs. */
	readonly signal?: AbortSignal;
}

export interface ServeTarget {
	readonly config: ResolvedConfig;
	/** The name of its project file, which a running server reports. */
	readonly project: string;
	readonly address: ServeAddress;
	readonly servedBy?: ServerInfo;
	/** The record of a server whose `rogen serve` ended without ending it, which holds the port and must end before this target starts. */
	readonly orphan?: {
		readonly pid?: number;
		readonly owner?: number;
		readonly session?: string;
	};
}

export type ServedTarget = ServeTarget & { readonly servedBy: ServerInfo };

export const isServed = (target: ServeTarget): target is ServedTarget =>
	target.servedBy !== undefined;

export class ServePlan {
	constructor(
		readonly selection: ReloadableSelection,
		readonly executable: ServerExecutable,
		readonly target: ServeTarget,
		readonly serverArgs: readonly string[]
	) {}

	/** Whether another serve already serves the target, so nothing is written or watched. */
	get isIdle(): boolean {
		return isServed(this.target);
	}
}

/** A server the session started, once it answers for its project. */
export interface ServerReadyEvent {
	readonly target: ServeTarget;
	readonly info: ServerInfo;
}

/** A server that crashed was started again, and the new one answers. */
export interface ServerRestartEvent extends ServerReadyEvent {
	/** How the one that crashed exited. */
	readonly exit: ProcessExit;
}

/** A Studio plugin connected to a server the session started, or left it. */
export interface ServerConnectionEvent {
	readonly target: ServeTarget;
	/** Whether a plugin connected, else one left. */
	readonly opened: boolean;
	readonly clients: number;
}

export interface ServerOutputEvent {
	readonly target: ServeTarget;
	readonly message: ServerMessage;
}

/** A server the session started that stopped before the session did, by how it stopped. */
export type ServerExitEvent =
	/** It couldn't start because another `rogen serve` started a server for its project file on its address first, which serves it; the stop is no failure. */
	| {
			readonly kind: "served-elsewhere";
			readonly target: ServeTarget;
			readonly servedBy: ServerInfo;
	  }
	/** It stopped on its own without an error. */
	| {
			readonly kind: "stopped";
			readonly target: ServeTarget;
			readonly exit: ProcessExit;
	  }
	/** It was interrupted along with Rogen, as Ctrl+C does, rather than stopping on its own. */
	| {
			readonly kind: "interrupted";
			readonly target: ServeTarget;
			readonly exit: ProcessExit;
	  }
	/** It crashed again right after Rogen restarted it after a crash, so Rogen gave up. */
	| {
			readonly kind: "crashed";
			readonly target: ServeTarget;
			readonly exit: ProcessExit;
			readonly failure: Diagnostic;
	  }
	/** It couldn't start, or exited with an error. */
	| {
			readonly kind: "failed";
			readonly target: ServeTarget;
			readonly exit: ProcessExit;
			readonly failure: Diagnostic;
	  };

/** How a serve ended. */
export type ServeEnding =
	/** It never served: the watch couldn't start, a write threw before a server started, or the Rojo that runs can't serve a file it wrote. */
	| { readonly kind: "refused"; readonly error: Error }
	/** A server stopped before the shutdown, which ended the serve. */
	| { readonly kind: "exited"; readonly exit: ServerExitEvent }
	/** The shutdown ended it. `exit` is a server's stop that came first and wasn't the shutdown's doing; `ended` is the server the shutdown ended, when it is another. */
	| {
			readonly kind: "shutdown";
			readonly exit?: ServerExitEvent;
			readonly ended?: ServeTarget;
	  };

/** How the servers changed with the configs after the session started them. */
export type ServeChangeEvent =
	/** A server stopped on purpose: its config is gone or moved to another address. */
	| {
			readonly kind: "retired";
			readonly target: ServeTarget;
			readonly reason: "removed" | "moved";
	  }
	/** A config to serve couldn't be served: its port is taken or it names another server than this serve runs. */
	| {
			readonly kind: "refused";
			readonly target: ServeTarget;
			readonly diagnostic: Diagnostic;
	  }
	/** A config to serve is already served by a server the session didn't start. */
	| { readonly kind: "servedElsewhere"; readonly target: ServedTarget }
	/** The server a `rogen serve` that ended left on the target's port was ended so this one could start; `error` says why it couldn't be. */
	| {
			readonly kind: "orphan";
			readonly target: ServeTarget;
			/** The process that led the server. */
			readonly pid: number;
			/** The `rogen serve` that started it. */
			readonly owner?: number;
			readonly error?: string;
	  };

/** A running serve; the caller owns it and disposes it. */
export interface ServeSession extends Disposable {
	readonly onDidUpdate: Event<WatchUpdate>;
	/** A step failed unexpectedly; the serve goes on. */
	readonly onDidError: Event<Error>;
	/** Fired once for each server started, when it answers. */
	readonly onDidServe: Event<ServerReadyEvent>;
	/** Fired when a server that crashed was started again, once the new one answers. */
	readonly onDidRestart: Event<ServerRestartEvent>;
	/** Fired when a Studio plugin connects to a server the session started, or leaves it; a server that doesn't say fires nothing. */
	readonly onDidConnect: Event<ServerConnectionEvent>;
	/** Fired for each message a server prints; its own info logs and noise come as `debug`. */
	readonly onDidOutput: Event<ServerOutputEvent>;
	readonly onDidChange: Event<ServeChangeEvent>;

	/** The target a server of the session runs for; none until one starts. */
	readonly target: ServeTarget | undefined;

	/** Writes, starts the servers once a write succeeds, and serves until `shutdown` aborts or a server stops; resolves once every server and the watch have stopped, with how it ended. */
	run(shutdown: AbortSignal): Promise<ServeEnding>;
}

export interface ServeService {
	readonly _serviceBrand: undefined;

	/** Fails when the config is broken, no server can run, or something else holds the port. */
	prepare(request: ServeRequest): Promise<Result<ServePlan, Error>>;

	/** A session for `plan`. Fails as a watch would when the configs can't be written together. */
	serve(plan: ServePlan): Result<ServeSession, DiagnosticsError>;
}

export const ServeService =
	createServiceIdentifier<ServeService>("serveService");
