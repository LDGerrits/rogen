import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import { ConfigBuild, Locations } from "./build.js";

export interface BuildOptions {
	/** Also checks the sync dir holds the compiler's output; that only changes when the compiler runs, so a watch does it on load. */
	readonly checkSyncDir?: boolean;
}

/** What `locate` is asked about; `cwd` resolves relative paths and tells a path from an instance. */
export interface LocateTargets {
	readonly args: readonly string[];
	readonly cwd: string;
}

/** Builds configs from the index and writes them; `build`, `rebuild` and `locate` place files the same way. */
export interface BuildService {
	readonly _serviceBrand: undefined;

	/** Fails when a config is broken or the configs can't be built together. Otherwise builds every config, then writes them in order; any build failure writes nothing, and a failed write leaves the rest unwritten. */
	build(
		selection: ConfigSelection,
		options?: BuildOptions
	): Promise<Result<ConfigBuild[], DiagnosticsError>>;

	/** Builds one config of a watch from the listing the watch holds, and writes it; the caller checked it can be built beside the others. */
	rebuild(
		config: ResolvedConfig,
		listing: IndexReader,
		options?: BuildOptions
	): Promise<ConfigBuild>;

	/** Where each argument lands in every config of `selection`: a path (relative to `cwd`) gives its file, and a directory stands for what's in it. An argument that starts with a service gives the files placed at that instance or inside it, unless `cwd` holds an entry of that name. No arguments give every file. Fails when a config is broken or declares no routes. */
	locate(
		selection: ConfigSelection,
		targets?: LocateTargets
	): Promise<Result<Locations, DiagnosticsError>>;
}

export const BuildService =
	createServiceIdentifier<BuildService>("buildService");
