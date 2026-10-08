import { Disposable } from "../../base/disposable.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ConfigOptionValues, ResolvedConfig } from "./config.js";

interface ConfigEntryFields {
	readonly file: string;
	/** The configs it extends, the nearest first, as far as the chain could be read. */
	readonly parents: readonly string[];
}

export interface ValidConfigEntry extends ConfigEntryFields {
	readonly status: "valid";
	readonly config: ResolvedConfig;
}

export interface BrokenConfigEntry extends ConfigEntryFields {
	readonly status: "broken";
	/** Never empty. */
	readonly errors: readonly Diagnostic[];
	/** The version a watch keeps building while the file is broken; none if it was never valid. */
	readonly lastValid: ResolvedConfig | undefined;
}

/** One config as it last loaded; a reload replaces it rather than mutating it. */
export type ConfigEntry = ValidConfigEntry | BrokenConfigEntry;

/** What builds for `entry`: the config now, else its last valid version. */
export function buildableConfig(
	entry: ConfigEntry
): ResolvedConfig | undefined {
	return entry.status === "valid" ? entry.config : entry.lastValid;
}

/** What a reload says of one config: new errors, a recovery, or joining or leaving the selection. */
export type ConfigNotice =
	| {
			readonly kind: "broken";
			readonly file: string;
			readonly errors: readonly Diagnostic[];
			/** Whether an earlier valid version still builds; a config that never loaded has none. */
			readonly keptLastValid: boolean;
	  }
	| { readonly kind: "recovered"; readonly file: string }
	/** A config appeared in the folder the selection was picked from, and loads. */
	| { readonly kind: "added"; readonly file: string }
	/** A config left that folder. */
	| { readonly kind: "removed"; readonly file: string };

/** What one `reload` did. */
export interface ConfigReload {
	/** The config files whose buildable version changed, in selection order. */
	readonly changed: readonly string[];
	readonly notices: readonly ConfigNotice[];
}

/** The configs one invocation picked. The caller owns it, and only `reload` changes it. */
export interface ConfigSelection {
	readonly entries: readonly ConfigEntry[];
	/** Every file the selected configs read: their chains and templates. */
	readonly files: ReadonlySet<string>;
	/** The folder configs were looked for in: the working directory, or the nearest folder above it with configs when it has none. */
	readonly home: string;
	/** The folder the selection was picked from, when no config was named; a `reload` follows its added and deleted configs. */
	readonly directory: string | undefined;

	/** Whether `reload` should hear of a change to `file`. */
	concerns(file: string): boolean;

	/** The configs, or every error when any entry is broken now. */
	requireValid(): Result<ResolvedConfig[], DiagnosticsError>;

	/** Reloads every config that reads one of `files`, after any earlier reload. A broken config keeps its last valid version. A selection with a `directory` first adds and drops the configs that came and went. */
	reload(files: readonly string[]): Promise<ConfigReload>;
}

/** The configs of a folder above the working directory. */
export interface EnclosingConfigs {
	readonly directory: string;
	/** File names, sorted. */
	readonly fileNames: readonly string[];
}

/** A config file that failed to load, as a file check sees it. */
export interface FailedConfigFile {
	readonly file: string;
	/** What the file holds when it parses as JSON; `undefined` when it doesn't. */
	readonly value: unknown;
}

/** Adds hints to the errors of a config file that failed to load. */
export type ConfigFileCheck = (
	failed: FailedConfigFile
) => readonly Diagnostic[];

/** Finds, loads and resolves configs. It keeps no loaded configs between calls, only the file checks registered on it: the selection it hands out holds the configs. */
export interface ConfigService {
	readonly _serviceBrand: undefined;

	/** Loads the configs `refs` names, each a name or a path, or every config in the working directory when it names none (or in the nearest folder above that has any, when the working directory has none), with the overrides `options` set. Fails only when they can't be picked; a broken config lands on its entry. */
	select(
		refs: readonly string[],
		options: ConfigOptionValues
	): Promise<Result<ConfigSelection, Error>>;
	/** The nearest folder above the working directory that has configs. */
	findEnclosing(): Promise<EnclosingConfigs | undefined>;
	/** Loads one config file as `select` would, without overrides and outside any selection. */
	read(file: string): Promise<ConfigEntry>;
	/** Runs `check` on every config file that can't be read as a config (unnamed, not JSON, or against the schema), never on one that can; what it returns is added to that file's errors. Dispose the result to remove it. */
	registerFileCheck(check: ConfigFileCheck): Disposable;
}

export const ConfigService =
	createServiceIdentifier<ConfigService>("configService");
