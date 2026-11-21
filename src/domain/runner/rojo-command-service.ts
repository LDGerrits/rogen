import { Disposable } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoRestartEvent } from "./rojo-runner.js";
import { ServerMessage } from "./rojo-server.js";

export interface RojoCommandRequest {
	readonly command: string;
	readonly flags: readonly string[];
	readonly cwd: string;
	readonly project?: ResolvedConfig;
	readonly projectFile?: string;
	readonly since?: string;
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
	readonly failure?: DiagnosticsError | UsageError;
}

export interface RojoWatchRequest extends RojoCommandRequest {
	readonly beforeRestart?: () => Promise<void>;
}

export interface RojoWatchExitEvent {
	readonly failure?: DiagnosticsError;
}

export interface RojoWatch extends Disposable {
	readonly onDidRun: Event<RojoCommandRun>;
	readonly onDidRestart: Event<RojoRestartEvent>;
	readonly onDidExit: Event<RojoWatchExitEvent>;

	terminate(): Promise<void>;
}

export interface RojoCommandService {
	readonly _serviceBrand: undefined;

	choose(selection: ConfigSelection): ResolvedConfig;

	run(
		selection: ConfigSelection,
		request: RojoCommandRequest
	): Promise<Result<RojoCommandRun, Error>>;

	watch(
		selection: ConfigSelection,
		request: RojoWatchRequest
	): Promise<Result<RojoWatch, Error>>;

	runBare(request: RojoBareRequest): Promise<Result<RojoBareRun, Error>>;
}

export const RojoCommandService =
	createDecorator<RojoCommandService>("rojoCommandService");
