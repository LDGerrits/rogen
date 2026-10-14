import { Disposable } from "../../base/disposable.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import {
	ResolvedConfig,
	ResolvedConfigFile,
	projectsOf,
} from "./resolved-config.js";

export const ConfigArguments = [
	{
		name: "project",
		description:
			"A folder with a rogen.json, a *.project.json path, or the name of a project of the rogen.json here. The rogen.json of the working directory, or of the nearest folder above it that has one, when none is given.",
		isOptional: true,
		isVariadic: true,
	},
] as const;

interface ConfigEntryFields {
	readonly file: string;
	/** The place folders read, when the selection reads only them; none reads the config and all its places. */
	readonly scope?: readonly string[];
}

export interface ValidConfigEntry
	extends ConfigEntryFields, ResolvedConfigFile {
	readonly status: "valid";
}

export interface BrokenConfigEntry extends ConfigEntryFields {
	readonly status: "broken";
	/** Never empty. */
	readonly errors: readonly Diagnostic[];
	/** The version a watch keeps building while the file is broken; undefined if it was never valid. */
	readonly lastValid: ResolvedConfigFile | undefined;
}

/** One config as it last loaded; a reload replaces it. */
export type ConfigEntry = ValidConfigEntry | BrokenConfigEntry;

export function buildableFile(
	entry: ConfigEntry
): ResolvedConfigFile | undefined {
	return entry.status === "valid" ? entry : entry.lastValid;
}

export function buildableConfig(
	entry: ConfigEntry
): ResolvedConfig | undefined {
	return buildableFile(entry)?.config;
}

/** Every project that builds for `entry`, the description first. */
export function buildableProjects(entry: ConfigEntry): ResolvedConfig[] {
	const file = buildableFile(entry);
	return file ? projectsOf(file, entry.scope) : [];
}

export type ConfigNotice =
	| {
			readonly kind: "broken";
			readonly file: string;
			readonly errors: readonly Diagnostic[];
			/** Whether an earlier valid version still builds. */
			readonly keptLastValid: boolean;
	  }
	| { readonly kind: "recovered"; readonly file: string }
	| { readonly kind: "added"; readonly file: string }
	| { readonly kind: "removed"; readonly file: string };

export interface ConfigReload {
	/** The config files whose buildable version changed, in selection order. */
	readonly changed: readonly string[];
	readonly notices: readonly ConfigNotice[];
}

export interface ConfigSelection {
	readonly entries: readonly ConfigEntry[];
	/** Every project that builds now, each config's description first; a broken entry gives its last valid version or none. */
	readonly configs: readonly ResolvedConfig[];
	/** The project each config was asked for by name or project-file path, by config file. */
	readonly named: ReadonlyMap<string, string>;
	/** What picking had to say, such as a name matching both a folder and a project. */
	readonly notes: readonly string[];
	/** The folder configs were looked for in: the working directory, or the nearest folder above it with a config when it has none. */
	readonly home: string;

	/** The projects of every config, or every error when any entry is broken now. */
	requireValid(): Result<ResolvedConfig[], DiagnosticsError>;
}

/** The caller owns it; only `reload` changes it. */
export interface ReloadableSelection extends ConfigSelection {
	readonly files: ReadonlySet<string>;
	/** The folder the selection was picked from when no config was named; a `reload` follows its added and deleted configs. */
	readonly followedFolder: string | undefined;

	/** Whether a selected config reads `file`; a watcher reports POSIX paths on every system, so any spelling of the path matches. */
	reads(file: string): boolean;

	/** Whether `reload` should hear of a change to `file`: one a selected config reads, or a config that came to the folder. */
	concerns(file: string): boolean;

	/** Reloads every config that reads one of `files`, after any earlier reload. A broken config keeps its last valid version; a followed folder's added and dropped configs join and leave first. */
	reload(files: readonly string[]): Promise<ConfigReload>;
}

export interface EnclosingConfigs {
	readonly directory: string;
	/** File names, sorted. */
	readonly fileNames: readonly string[];
}

export interface FailedConfigFile {
	readonly file: string;
	/** What the file holds when it parses as JSON; `undefined` when it doesn't. */
	readonly value: unknown;
}

export type ConfigFileCheck = (
	failed: FailedConfigFile
) => readonly Diagnostic[];

/** Finds, loads and resolves configs. It keeps none: the selection it hands out holds them. */
export interface ConfigService {
	readonly _serviceBrand: undefined;

	/** Loads the configs `refs` names, else the one here or in the nearest folder above. Fails only when they can't be picked; a broken config lands on its entry. */
	select(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>>;
	/** The nearest folder above `from`, the working directory unless given, that has configs. */
	findEnclosing(from?: string): Promise<EnclosingConfigs | undefined>;
	/** Loads one config file as `select` would, outside any selection. */
	read(file: string): Promise<ConfigEntry>;
	/** Runs `check` on every config file that is read, and on what a file holds that fails to load; what it returns is added to that file's errors. Dispose the result to remove it. */
	registerFileCheck(check: ConfigFileCheck): Disposable;
}

export const ConfigService =
	createServiceIdentifier<ConfigService>("configService");
