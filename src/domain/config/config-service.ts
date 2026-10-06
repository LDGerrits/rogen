import { Disposable } from "../../base/disposable.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ConfigOptionValues, ResolvedConfig } from "./config.js";

/** How a command reads a line that names no config. */
export interface ConfigScope {
	/** What naming none reads: the default config, or every config here. */
	readonly unnamed?: "default" | "all";
}

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

/** What a reload says of one config: its latest load found errors the previous one didn't, or a broken config loads again. */
export type ConfigNotice =
	| {
			readonly kind: "broken";
			readonly file: string;
			readonly errors: readonly Diagnostic[];
	  }
	| { readonly kind: "recovered"; readonly file: string };

/** What one `reload` did. */
export interface ConfigReload {
	/** The config files whose buildable version changed, in selection order. */
	readonly changed: readonly string[];
	readonly notices: readonly ConfigNotice[];
}

/** The configs one invocation picked. The caller owns it, and only `reload` changes it. */
export interface ConfigSelection {
	readonly entries: readonly ConfigEntry[];
	/** The config files in the working dir it didn't pick, as sorted absolute paths. */
	readonly unselected: readonly string[];
	/** Every file the selected configs read: their chains and templates. */
	readonly files: ReadonlySet<string>;

	/** The configs, or every error when any entry is broken now. */
	requireValid(): Result<ResolvedConfig[], DiagnosticsError>;
	/** What a command that reports on every config ends with when some are broken, or `undefined` when none are. */
	readonly brokenError: Error | undefined;

	/** Reloads every config that reads one of `files`, after any earlier reload. A broken config keeps its last valid version. */
	reload(files: readonly string[]): Promise<ConfigReload>;
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

	/** Loads the configs a command line picks by `names`, `-c` and `--all`, with the overrides its `options` set. Fails only when they can't be picked; a broken config lands on its entry. */
	select(
		names: readonly string[],
		options: ConfigOptionValues,
		scope?: ConfigScope
	): Promise<Result<ConfigSelection, Error>>;
	/** Loads one config file as `select` would, without overrides and outside any selection. */
	read(file: string): Promise<ConfigEntry>;
	/** Runs `check` on every config file that fails to load, never on one that loads; what it returns is added to that file's errors. Dispose the result to remove it. */
	registerFileCheck(check: ConfigFileCheck): Disposable;
}

export const ConfigService =
	createServiceIdentifier<ConfigService>("configService");
