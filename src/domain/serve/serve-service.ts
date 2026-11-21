import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { ProcessExit } from "../../platform/process/process-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ReloadableSelection } from "../config/config-service.js";
import { WatchUpdate } from "../watch/watch-service.js";
import { ServerExecutable } from "../runner/rojo-runner.js";
import { ServerInfo, ServerMessage } from "../runner/rojo-server.js";
import { ServeAddress } from "./serve.js";

export interface ServeRequest {
	readonly refs: readonly string[];
	readonly serverArgs: readonly string[];
	readonly signal?: AbortSignal;
}

export interface ServeTarget {
	readonly config: ResolvedConfig;
	readonly project: string;
	readonly address: ServeAddress;
	readonly servedBy?: ServerInfo;
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

	get isIdle(): boolean {
		return isServed(this.target);
	}
}

export interface ServerReadyEvent {
	readonly target: ServeTarget;
	readonly info: ServerInfo;
}

export interface ServerRestartEvent extends ServerReadyEvent {
	readonly exit: ProcessExit;
}

export interface ServerConnectionEvent {
	readonly target: ServeTarget;
	readonly opened: boolean;
	readonly clients: number;
}

export interface ServerOutputEvent {
	readonly target: ServeTarget;
	readonly message: ServerMessage;
}

export type ServerExitEvent =
	| {
			readonly kind: "served-elsewhere";
			readonly target: ServeTarget;
			readonly servedBy: ServerInfo;
	  }
	| {
			readonly kind: "stopped";
			readonly target: ServeTarget;
			readonly exit: ProcessExit;
	  }
	| {
			readonly kind: "interrupted";
			readonly target: ServeTarget;
			readonly exit: ProcessExit;
	  }
	| {
			readonly kind: "crashed";
			readonly target: ServeTarget;
			readonly exit: ProcessExit;
			readonly failure: Diagnostic;
	  }
	| {
			readonly kind: "failed";
			readonly target: ServeTarget;
			readonly exit: ProcessExit;
			readonly failure: Diagnostic;
	  };

export type ServeEnding =
	| { readonly kind: "refused"; readonly error: Error }
	| { readonly kind: "exited"; readonly exit: ServerExitEvent }
	| {
			readonly kind: "shutdown";
			readonly exit?: ServerExitEvent;
			readonly ended?: ServeTarget;
	  };

export type ServeChangeEvent =
	| {
			readonly kind: "retired";
			readonly target: ServeTarget;
			readonly reason: "removed" | "moved";
	  }
	| {
			readonly kind: "refused";
			readonly target: ServeTarget;
			readonly diagnostic: Diagnostic;
	  }
	| { readonly kind: "servedElsewhere"; readonly target: ServedTarget }
	| {
			readonly kind: "orphan";
			readonly target: ServeTarget;
			readonly pid: number;
			readonly owner?: number;
			readonly error?: string;
	  };

export interface ServeSession extends Disposable {
	readonly onDidUpdate: Event<WatchUpdate>;
	readonly onDidError: Event<Error>;
	readonly onDidServe: Event<ServerReadyEvent>;
	readonly onDidRestart: Event<ServerRestartEvent>;
	readonly onDidConnect: Event<ServerConnectionEvent>;
	readonly onDidOutput: Event<ServerOutputEvent>;
	readonly onDidChange: Event<ServeChangeEvent>;

	readonly target: ServeTarget | undefined;

	run(shutdown: AbortSignal): Promise<ServeEnding>;
}

export interface ServeService {
	readonly _serviceBrand: undefined;

	prepare(request: ServeRequest): Promise<Result<ServePlan, Error>>;

	serve(plan: ServePlan): Result<ServeSession, DiagnosticsError>;
}

export const ServeService = createDecorator<ServeService>("serveService");
