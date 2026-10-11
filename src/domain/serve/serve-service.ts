import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { PathSet } from "../../base/path.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { OptionDescriptor } from "../../platform/environment/args.js";
import { ProcessExit } from "../../platform/process/process-service.js";
import { ResolvedConfig } from "../config/config.js";
import {
	ConfigOptionValues,
	ReloadableSelection,
} from "../config/config-service.js";
import { WatchUpdate } from "../watch/watch-service.js";
import {
	ServeAddress,
	ServerInfo,
	ServerMessage,
	SyncServer,
} from "./serve.js";

/** The option that picks the sync server to serve with. */
export const ServerOption = {
	name: "server",
	type: "string",
	placeholder: SyncServer.ALL.map(({ id }) => id).join("|"),
	description:
		"Serves with this sync server, over the configs' server field; without either, the one the project pins, Rojo before Argon.",
} as const satisfies OptionDescriptor;

export interface ServeRequest {
	/** The configs to serve, by name or path; every config here that no other extends when none. */
	readonly refs: readonly string[];
	readonly options: ConfigOptionValues;
	/** The id of the server to start, `rojo` or `argon`; the one the served configs name when not given, else the one the project pins, Rojo before Argon. */
	readonly serverId?: string;
	/** Passed to the server after the project file, untouched. */
	readonly serverArgs: readonly string[];
	/** Ends the checks that run other programs, when the run is stopped before it has started. */
	readonly signal?: AbortSignal;
}

/** The server a serve starts, as found and checked. */
export interface ServerExecutable {
	readonly server: SyncServer;
	/** The file that runs it. */
	readonly file: string;
	readonly version: string;
	/** Another server the project pins, which this one was picked over. */
	readonly passedOver?: SyncServer;
}

/** One config a serve serves. */
export interface ServeTarget {
	readonly config: ResolvedConfig;
	/** The name of its project file, which a running server reports. */
	readonly project: string;
	readonly address: ServeAddress;
	/** What already serves its project, when something does. */
	readonly servedBy?: ServerInfo;
	/** Whether `servedBy` is a server no serve started, which this serve builds for instead of starting one, and stops with. */
	readonly adopted?: boolean;
}

/** A target a server already serves. */
export type ServedTarget = ServeTarget & { readonly servedBy: ServerInfo };

export const isServed = (target: ServeTarget): target is ServedTarget =>
	target.servedBy !== undefined;

/** What a serve will do: the configs it builds, the server it runs, and each config it serves. */
export class ServePlan {
	constructor(
		readonly selection: ReloadableSelection,
		readonly executable: ServerExecutable,
		readonly targets: readonly ServeTarget[],
		readonly serverArgs: readonly string[],
		/** The config files named on the command line, the only ones served; `undefined` when the serve follows its folder's configs. */
		readonly named?: PathSet,
		/** The configs in the working folder that the selection leaves out. */
		readonly neighbours: readonly ResolvedConfig[] = [],
		/** Whether `--server` picked the server, so no config's `server` field is asked. */
		readonly serverAsked = false
	) {}

	/** The targets a server already serves. */
	get alreadyServed(): ServedTarget[] {
		return this.targets.filter(isServed);
	}

	/** The targets this serve starts a server for. */
	get toStart(): ServeTarget[] {
		return this.targets.filter(({ servedBy }) => servedBy === undefined);
	}

	/** The targets a server no serve started already serves, which this serve builds for. */
	get adopted(): ServedTarget[] {
		return this.alreadyServed.filter(({ adopted }) => adopted);
	}

	/** Whether another serve already serves every target, so nothing is built or watched. */
	get isIdle(): boolean {
		return this.toStart.length === 0 && this.adopted.length === 0;
	}
}

/** A server the session started, once it answers for its project. */
export interface ServerReadyEvent {
	readonly target: ServeTarget;
	readonly info: ServerInfo;
}

/** Something a server the session started said that is worth showing. */
export interface ServerOutputEvent {
	readonly target: ServeTarget;
	readonly message: ServerMessage;
}

/** A server the session started or adopted that stopped before the session did. */
export type ServerExitEvent = {
	readonly target: ServeTarget;
	/** How its process exited; none for an adopted server, which only stopped answering. */
	readonly exit?: ProcessExit;
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
export type ServeChangeEvent =
	/** A server stopped on purpose: its config is gone, another config now extends it, or its template moved it to another address, where a new server starts. */
	| {
			readonly kind: "retired";
			readonly target: ServeTarget;
			readonly reason: "removed" | "extended" | "moved";
	  }
	/** A config to serve now couldn't be served, as its port is taken or it names another server than this serve runs; the others go on, and so does its own server if it has one. */
	| {
			readonly kind: "refused";
			readonly target: ServeTarget;
			readonly diagnostic: Diagnostic;
	  }
	/** A config to serve now is already served by a server the session didn't start. */
	| { readonly kind: "servedElsewhere"; readonly target: ServedTarget };

/** A running serve: a watch of the plan's configs, and a server for each target nothing served, or the adopted one that serves it. The caller owns it and disposes it. */
export interface ServeSession extends Disposable {
	readonly onDidUpdate: Event<WatchUpdate>;
	/** A step failed unexpectedly; the serve goes on. */
	readonly onDidError: Event<Error>;
	/** Fired once for each server started, when it answers. */
	readonly onDidServe: Event<ServerReadyEvent>;
	/** Fired for each message a server prints; its own info logs and noise come as `debug`. */
	readonly onDidOutput: Event<ServerOutputEvent>;
	/** Fired when the configs to serve change while it serves. */
	readonly onDidChange: Event<ServeChangeEvent>;
	/** Fired when a server stops before the session does, after what it said, or when an adopted one stops answering for its project. */
	readonly onDidExit: Event<ServerExitEvent>;

	/** The targets it runs or adopted a server for now. */
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
