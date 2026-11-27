import { Disposable } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { WatchUpdate } from "../watch/watch-service.js";
import { WriteRun } from "../write/write.js";
import { RojoRestartEvent } from "./rojo-runner.js";
import { ServerMessage } from "./rojo-server.js";

export type RojoVerb = "build" | "sourcemap" | "upload";

export interface RojoRunRequest {
	readonly refs: readonly string[];
	readonly command: RojoVerb;
	readonly flags: Result<readonly string[], UsageError>;
	readonly cwd: string;
	readonly prints?: boolean;
	readonly signal?: AbortSignal;
}

export interface RojoRunFailure {
	readonly at: "write" | "rojo";
	readonly error: Error;
}

export interface RojoRunOutcome {
	readonly home: string;
	readonly notes: readonly string[];
	readonly project: ResolvedConfig | undefined;
	readonly written: WriteRun;
	readonly ran: Result<RojoCommandRun, Error> | undefined;
	readonly failure: RojoRunFailure | undefined;
	readonly changed: boolean;
}

export type RojoRunEnding =
	| { readonly kind: "stopped" }
	| { readonly kind: "failed"; readonly error: Error };

export interface RojoRunWatch extends Disposable {
	readonly home: string;
	readonly notes: readonly string[];
	readonly configs: readonly ResolvedConfig[];
	readonly onDidUpdate: Event<WatchUpdate>;
	readonly onDidError: Event<Error>;
	readonly onDidRun: Event<Result<RojoCommandRun, Error>>;
	readonly onDidRestart: Event<RojoRestartEvent>;

	run(shutdown: AbortSignal): Promise<Result<RojoRunEnding, Error>>;
}

export interface RojoCommandRequest {
	readonly command: string;
	readonly flags: readonly string[];
	readonly cwd: string;
	readonly project: ResolvedConfig;
	readonly projectFile?: string;
	readonly since?: string;
	readonly prints?: boolean;
	readonly signal?: AbortSignal;
}

export interface RojoBareRequest {
	readonly args: readonly string[];
	readonly cwd: string;
	readonly signal?: AbortSignal;
}

export interface RojoBareRun {
	readonly messages: readonly ServerMessage[];
	readonly failure?: Error;
}

export interface RojoCommandRun extends RojoBareRun {
	readonly project: ResolvedConfig;
	readonly printed?: string;
	readonly failure?: DiagnosticsError | UsageError;
}

export interface RojoCommandService {
	readonly _serviceBrand: undefined;

	run(request: RojoRunRequest): Promise<Result<RojoRunOutcome, Error>>;

	watch(request: RojoRunRequest): Promise<Result<RojoRunWatch, Error>>;

	runOn(
		selection: ConfigSelection,
		request: RojoCommandRequest
	): Promise<Result<RojoCommandRun, Error>>;

	runBare(request: RojoBareRequest): Promise<Result<RojoBareRun, Error>>;
}

export const RojoCommandService =
	createDecorator<RojoCommandService>("rojoCommandService");
