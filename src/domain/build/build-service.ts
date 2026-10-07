import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ConfigSelection } from "../config/config-service.js";
import { BuildSet, ConfigBuild, LoadedBuild, Locations } from "./build.js";

/** What `locate` is asked about; `cwd` resolves relative paths and tells a path from an instance. */
export interface LocateTargets {
	readonly args: readonly string[];
	readonly cwd: string;
}

/** Builds configs from the index and writes them; `build`, `rebuild` and `locate` place files the same way. */
export interface BuildService {
	readonly _serviceBrand: undefined;

	/** Fails when the configs that load can't be built together. Otherwise returns one build per selected config, in order: builds each one that loads, checking its sync dir, then writes them in order. A build failure, or a config that doesn't load, writes nothing, and a failed write leaves the rest unwritten. */
	build(
		selection: ConfigSelection
	): Promise<Result<ConfigBuild[], DiagnosticsError>>;

	/** Builds the config `file` of a watch's `set` from the listing the watch holds, and writes it; one the set blocks fails without building. The sync dir is checked only when `previous` holds no answer for this version of the config, since it changes only with the config or its compiler. */
	rebuild(
		set: BuildSet,
		file: string,
		listing: IndexReader,
		previous?: LoadedBuild
	): Promise<LoadedBuild>;

	/** Where each argument lands in every config of `selection`: a path (relative to `cwd`) gives its file, and a directory stands for what's in it. An argument that starts with a service gives the files placed at that instance or inside it, unless `cwd` holds an entry of that name. No arguments give every file. Fails when a config is broken or declares no routes. */
	locate(
		selection: ConfigSelection,
		targets?: LocateTargets
	): Promise<Result<Locations, DiagnosticsError>>;
}

export const BuildService =
	createServiceIdentifier<BuildService>("buildService");
