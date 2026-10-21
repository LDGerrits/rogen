import { Disposable } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig, ResolvedConfigFile } from "./resolved-config.js";

const PROJECT_DESCRIPTION =
	"A folder, a .rogen.json file, a *.project.json path, or the name of a file here (dist for dist.rogen.json). The default.rogen.json of the working directory, or its default.project.json, when none is given.";

/** The `[PROJECT]` of a Rojo verb, which takes one. */
export const ProjectArgument = [
	{ name: "project", description: PROJECT_DESCRIPTION, isOptional: true },
] as const;

/** Rojo's usage error for a second `[PROJECT]`. */
export function singleProjectError(
	command: string,
	refs: readonly string[],
	hint?: string
): UsageError | undefined {
	return refs.length > 1
		? new UsageError(
				`unexpected argument '${refs[1]}' found: ${command} takes one [PROJECT].`,
				hint ?? `Usage: rogen ${command} [OPTIONS] [PROJECT]`
			)
		: undefined;
}

export const ConfigArguments = [
	{
		name: "project",
		description: PROJECT_DESCRIPTION,
		isOptional: true,
		isVariadic: true,
	},
] as const;

interface ConfigEntryFields {
	readonly file: string;
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

function buildableConfig(entry: ConfigEntry): ResolvedConfig | undefined {
	return buildableFile(entry)?.config;
}

/** The config that builds for `entry`, if one does. */
export function buildableConfigs(entry: ConfigEntry): ResolvedConfig[] {
	const config = buildableConfig(entry);
	return config ? [config] : [];
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
	/** Every config that builds now; a broken entry gives its last valid version or none. */
	readonly configs: readonly ResolvedConfig[];
	/** What picking had to say, such as a name matching both a folder and a file. */
	readonly notes: readonly string[];
	/** The folder configs were looked for in: the working directory. */
	readonly home: string;

	/** Every config, or every error when any entry is broken now. */
	requireValid(): Result<ResolvedConfig[], DiagnosticsError>;
}

/** The caller owns it; only `reload` changes it. */
export interface ReloadableSelection extends ConfigSelection {
	readonly files: ReadonlySet<string>;
	/** The folder the selection was picked from when no config was named; a `reload` follows the added and deleted default config of it, and no other file. */
	readonly followedFolder: string | undefined;

	/** Whether a selected config reads `file`; a watcher reports POSIX paths on every system, so any spelling of the path matches. */
	reads(file: string): boolean;

	/** Whether `reload` should hear of a change to `file`: one a selected config reads, or the default config that came to the folder. */
	concerns(file: string): boolean;

	/** Reloads the configs that read `files`, in order, keeping a broken config's last valid version so a watch survives a bad edit. */
	reload(files: readonly string[]): Promise<ConfigReload>;
}

export interface EnclosingConfigs {
	readonly directory: string;
	/** File names, sorted. */
	readonly fileNames: readonly string[];
}

/** The config file that answers for a path. */
export interface ConfigCover {
	readonly file: string;
	/** The path is a `.rogen.json` itself, so its config is answered whole. */
	readonly whole: boolean;
}

/** What `selectCovering` found for a list of targets. */
export interface CoveredTargets {
	/** One per config, in the order its first target was given. */
	readonly groups: readonly {
		readonly selection: ReloadableSelection;
		/** The targets this config answers for, by position. */
		readonly indexes: readonly number[];
		/** A target is a `.rogen.json`, so the config is answered whole. */
		readonly whole: boolean;
	}[];
	/** The targets no config covers, by position. */
	readonly uncovered: readonly number[];
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

	/** Loads the configs `refs` names, else the default of the working directory. Fails only when they can't be picked; a broken config lands on its entry. */
	select(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>>;
	/** Loads every config file of the working directory, so `list` can show the siblings without needing a default. */
	selectFolder(): Promise<Result<ReloadableSelection, Error>>;
	/** The nearest folder above `from`, the working directory unless given, that has a default config. */
	findEnclosing(from?: string): Promise<EnclosingConfigs | undefined>;
	/** The config that answers for `target`, so a command run from the root can take a path of any place. */
	coverOf(target: string): Promise<ConfigCover | undefined>;
	/** Loads the config that answers for each target, one selection per config, so a command can take paths of several places. */
	selectCovering(
		targets: readonly (string | undefined)[]
	): Promise<Result<CoveredTargets, Error>>;
	/** Loads one config file as `select` would, outside any selection. */
	read(file: string): Promise<ConfigEntry>;
	/** Rewrites one config file in Rojo's formatting, Rogen's keys after Rojo's; whether the file changed. A file with comments is left as it is, and so is a file that doesn't load as JSON. */
	format(file: string): Promise<Result<boolean, Diagnostic[]>>;
	/** Runs `check` on every config file that is read, and on what a file holds that fails to load; what it returns is added to that file's errors. Dispose the result to remove it. */
	registerFileCheck(check: ConfigFileCheck): Disposable;
}

export const ConfigService =
	createServiceIdentifier<ConfigService>("configService");
