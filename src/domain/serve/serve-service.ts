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
import {
	ServerInfo,
	ServerMessage,
	SyncServer,
} from "../runner/sync-server.js";
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

	/** Whether another serve already serves the target, so nothing is built or watched. */
	get isIdle(): boolean {
		return isServed(this.target);
	}
}

/** A server the session started, once it answers for its project. */
export interface ServerReadyEvent {
	readonly target: ServeTarget;
	readonly info: ServerInfo;
}

export interface ServingNow {
	readonly server: SyncServer;
	readonly host: string;
	readonly port: number;
	readonly clients?: number;
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

/** A server the session started that stopped before the session did. */
export type ServerExitEvent = {
	readonly target: ServeTarget;
	/** How its process exited. */
	readonly exit: ProcessExit;
	/** It was interrupted along with Rogen, as Ctrl+C does, rather than stopping on its own. */
	readonly interrupted: boolean;
} & (
	| {
			/** Why the stop is a failure: the server couldn't start, or exited with an error. */
			readonly failure: Diagnostic;
			/** The code the run exits with: the server's own, or 1 when it has none. */
			readonly exitCode: number;
	  }
	| { readonly failure?: undefined; readonly exitCode?: undefined }
);

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
	| { readonly kind: "servedElsewhere"; readonly target: ServedTarget };

/** A running serve; the caller owns it and disposes it. */
export interface ServeSession extends Disposable {
	readonly onDidUpdate: Event<WatchUpdate>;
	/** A step failed unexpectedly; the serve goes on. */
	readonly onDidError: Event<Error>;
	/** Fired once for each server started, when it answers. */
	readonly onDidServe: Event<ServerReadyEvent>;
	/** Fired when a Studio plugin connects to a server the session started, or leaves it; a server that doesn't say fires nothing. */
	readonly onDidConnect: Event<ServerConnectionEvent>;
	/** Fired for each message a server prints; its own info logs and noise come as `debug`. */
	readonly onDidOutput: Event<ServerOutputEvent>;
	readonly onDidChange: Event<ServeChangeEvent>;
	/** Fired when a server stops before the session does. */
	readonly onDidExit: Event<ServerExitEvent>;

	/** The target a server of the session runs for; none until one starts. */
	readonly target: ServeTarget | undefined;

	/** Builds, then starts the servers. Fails with the build's errors, starting none, when the first build fails or throws. */
	start(): Promise<Result<void, Error>>;
	/** Ends every server and its processes, then stops the watch. Safe to call twice. */
	stop(): Promise<void>;
}

export interface ServeService {
	readonly _serviceBrand: undefined;

	/** Fails when the config is broken, no server can run, or something else holds the port. */
	prepare(request: ServeRequest): Promise<Result<ServePlan, Error>>;

	/** A session for `plan`. Fails as a watch would when the configs can't be built together. */
	serve(plan: ServePlan): Result<ServeSession, DiagnosticsError>;

	/** For each of `projectFiles` that a running serve serves, the server it serves it with, as that serve recorded it, when the server still answers. */
	servedBy(
		projectFiles: readonly string[]
	): Promise<ReadonlyMap<string, ServingNow>>;
}

export const ServeService =
	createServiceIdentifier<ServeService>("serveService");
