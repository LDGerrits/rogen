import { UsageError } from "../../base/errors.js";
import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ServerMessage } from "./sync-server.js";

export interface RojoCommandRequest {
	/** The Rojo command, such as `build`. */
	readonly command: string;
	/** Rojo's own flags, passed on after the project file untouched. */
	readonly flags: readonly string[];
	/** Where Rojo runs, so a path in `flags` is relative to it. */
	readonly cwd: string;
	/** Ends the checks and the run. */
	readonly signal?: AbortSignal;
}

export interface RojoCommandRun {
	/** The project Rojo ran on. */
	readonly project: ResolvedConfig;
	/** What Rojo said, in order. */
	readonly messages: readonly ServerMessage[];
	/** Why the run failed, when Rojo exited with an error. */
	readonly failure?: DiagnosticsError;
}

export interface RojoCommandService {
	readonly _serviceBrand: undefined;

	/** The one project a Rojo command runs on: the one the selection names, else `default`. Fails when it holds none or several, which the caller can say before it writes anything. */
	choose(
		selection: ConfigSelection,
		command: string
	): Result<ResolvedConfig, UsageError>;

	/** Runs the pinned Rojo on the one project the selection names, or on its `default`, which the caller has written. Fails when the selection holds none or several projects, when its files are broken, or when the Rojo can't read them; a Rojo that exits with an error comes back as a run with a `failure`. */
	run(
		selection: ConfigSelection,
		request: RojoCommandRequest
	): Promise<Result<RojoCommandRun, Error>>;
}

export const RojoCommandService =
	createServiceIdentifier<RojoCommandService>("rojoCommandService");
