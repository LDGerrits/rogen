import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ServerMessage } from "./rojo-server.js";

export interface RojoCommandRequest {
	/** The Rojo command, such as `build`. */
	readonly command: string;
	/** Rojo's own flags, passed on after the project file untouched. */
	readonly flags: readonly string[];
	/** Where Rojo runs, so a path in `flags` is relative to it. */
	readonly cwd: string;
	/** The project to run on, when the caller already chose it. */
	readonly project?: ResolvedConfig;
	/** The project file Rojo reads, when it is not the project's own: an absolute path. */
	readonly projectFile?: string;
	/** The first Rojo release that has the command, so an older one is refused with a message that says so. */
	readonly since?: string;
	/** Ends the checks and the run. */
	readonly signal?: AbortSignal;
}

export interface RojoBareRequest {
	/** Everything after `rojo`, such as `plugin install`. */
	readonly args: readonly string[];
	/** Where Rojo runs, and where the pinned one is looked for. */
	readonly cwd: string;
	/** Ends the checks and the run. */
	readonly signal?: AbortSignal;
}

export interface RojoBareRun {
	/** What Rojo said, in order. */
	readonly messages: readonly ServerMessage[];
	/** Why the run failed, when Rojo exited with an error; no file is to blame. */
	readonly failure?: Error;
}

export interface RojoCommandRun extends RojoBareRun {
	/** The project Rojo ran on. */
	readonly project: ResolvedConfig;
	/** Why the run failed, when Rojo exited with an error, about the project file. */
	readonly failure?: DiagnosticsError;
}

export interface RojoCommandService {
	readonly _serviceBrand: undefined;

	/** The one project a Rojo command runs on; the selection must be valid. */
	choose(selection: ConfigSelection): ResolvedConfig;

	/** Runs the pinned Rojo on the project the selection names, which the caller has written. Fails when its files are broken or the Rojo can't read them; a Rojo that exits with an error comes back as a run with a `failure`. */
	run(
		selection: ConfigSelection,
		request: RojoCommandRequest
	): Promise<Result<RojoCommandRun, Error>>;

	/** Runs the pinned Rojo on no project, for a command such as `plugin install`: the one a toolchain file in `cwd` or above pins, else the one on the PATH. Fails when there is none or it can't start; a Rojo that exits with an error comes back as a run with a `failure`. */
	runBare(request: RojoBareRequest): Promise<Result<RojoBareRun, Error>>;
}

export const RojoCommandService =
	createServiceIdentifier<RojoCommandService>("rojoCommandService");
