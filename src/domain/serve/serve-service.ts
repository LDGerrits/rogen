import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ProcessExit } from "../../platform/process/process-service.js";
import { ConfigOptionValues, ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import { WatchUpdate } from "../watch/watch-service.js";
import {
	ServeAddress,
	ServerInfo,
	ServerMessage,
	SyncServer,
} from "./serve.js";

export interface ServeRequest {
	/** The configs to serve, by name or path; every config here that no other extends when none. */
	readonly refs: readonly string[];
	readonly options: ConfigOptionValues;
	/** The id of the server to start, `rojo` or `argon`; the one the project pins when not given, Rojo before Argon. */
	readonly server?: string;
	/** Passed to the server after the project file, untouched. */
	readonly serverArgs: readonly string[];
}

/** The server a serve starts, as found and checked. */
export interface ServeTool {
	readonly server: SyncServer;
	/** The file that runs it. */
	readonly file: string;
	readonly version: string;
	/** Another server the project has, which this one was picked over. */
	readonly passedOver?: SyncServer;
}

/** One config a serve serves. */
export interface ServeTarget {
	readonly config: ResolvedConfig;
	/** The name of its project file, which a running server reports. */
	readonly project: string;
	readonly address: ServeAddress;
	/** What already serves its project, when something does. */
	readonly running?: ServerInfo;
}

/** A target a server already serves. */
export type RunningTarget = ServeTarget & { readonly running: ServerInfo };

export const isRunning = (target: ServeTarget): target is RunningTarget =>
	target.running !== undefined;

/** What a serve will do: the configs it builds, the server it runs, and each config it serves. */
export class ServePlan {
	constructor(
		readonly selection: ConfigSelection,
		readonly tool: ServeTool,
		readonly targets: readonly ServeTarget[],
		readonly serverArgs: readonly string[],
		/** The config files named on the command line, the only ones served; `undefined` when the serve follows its folder's configs. */
		readonly named?: ReadonlySet<string>
	) {}

	/** The targets a server already serves. */
	get running(): RunningTarget[] {
		return this.targets.filter(isRunning);
	}

	/** The targets this serve starts a server for. */
	get toStart(): ServeTarget[] {
		return this.targets.filter(({ running }) => running === undefined);
	}

	/** Whether every target is served already, so nothing is built or watched. */
	get isIdle(): boolean {
		return this.toStart.length === 0;
	}
}

/** A server the session started, once it answers for its project. */
export interface ServingServer {
	readonly target: ServeTarget;
	readonly info: ServerInfo;
}

/** Something a server the session started said that is worth showing. */
export interface ServerSaid {
	readonly target: ServeTarget;
	readonly message: ServerMessage;
}

/** A server the session started that stopped before the session did. */
export type ServerStop = {
	readonly target: ServeTarget;
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

/** How the servers changed with the configs, after the session started them. A config that comes to be served starts its server as at the start, and says so through `onDidServe`. */
export type ServeChange =
	/** A server stopped on purpose: its config is gone, another config now extends it, or its template moved it to another address, where a new server starts. */
	| {
			readonly kind: "retired";
			readonly target: ServeTarget;
			readonly reason: "removed" | "extended" | "moved";
	  }
	/** A config to serve now couldn't be served, as its port is taken; the others go on. */
	| {
			readonly kind: "refused";
			readonly target: ServeTarget;
			readonly diagnostic: Diagnostic;
	  }
	/** A config to serve now is already served by a server the session didn't start. */
	| { readonly kind: "running"; readonly target: RunningTarget };

/** A running serve: a watch of the plan's configs, and a server for each target nothing served. The caller owns it and disposes it. */
export interface ServeSession extends Disposable {
	readonly onDidUpdate: Event<WatchUpdate>;
	/** A step failed unexpectedly; the serve goes on. */
	readonly onDidError: Event<Error>;
	/** Fired once for each server started, when it answers. */
	readonly onDidServe: Event<ServingServer>;
	/** Fired for each warning, error and unrecognised line a server prints; the rest of its output is dropped. */
	readonly onDidSay: Event<ServerSaid>;
	/** Fired when the configs to serve change while it serves. */
	readonly onDidChange: Event<ServeChange>;
	/** Fired when a server stops before the session does, after what it said. */
	readonly onDidStop: Event<ServerStop>;

	/** The targets it runs a server for now. */
	readonly targets: readonly ServeTarget[];

	/** Builds, then starts the servers. Fails with the build's errors, starting none, when the first build fails or throws. */
	start(): Promise<Result<void, Error>>;
	/** Ends every server and its processes, then stops the watch. Safe to call twice. */
	stop(): Promise<void>;
}

/** Builds and watches configs, and starts the sync server that serves their project files to Studio. */
export interface ServeService {
	readonly _serviceBrand: undefined;

	/** Selects the configs to watch and to serve, finds the server, and asks each served config's port what serves there. Fails when a config is broken, no server can run, two configs share a port, or something else holds one. */
	prepare(request: ServeRequest): Promise<Result<ServePlan, Error>>;

	/** A session for `plan`. Fails as a watch would when the configs can't be built together. */
	serve(plan: ServePlan): Result<ServeSession, DiagnosticsError>;
}

export const ServeService =
	createServiceIdentifier<ServeService>("serveService");
