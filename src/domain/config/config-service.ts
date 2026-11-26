import { Disposable } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig, ResolvedConfigFile } from "./resolved-config.js";

const PROJECT_DESCRIPTION =
	"A folder, a .rogen.json file, a *.project.json path, or a name such as dist for dist.rogen.json. Without one: default.rogen.json here, else default.project.json.";

export const ProjectArgument = [
	{ name: "project", description: PROJECT_DESCRIPTION, isOptional: true },
] as const;

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
	readonly errors: readonly Diagnostic[];
	readonly lastValid: ResolvedConfigFile | undefined;
	readonly sourcePaths?: readonly string[];
}

export type ConfigEntry = ValidConfigEntry | BrokenConfigEntry;

export function validFile(entry: ConfigEntry): ResolvedConfigFile | undefined {
	return entry.status === "valid" ? entry : entry.lastValid;
}

export function validConfigs(entry: ConfigEntry): ResolvedConfig[] {
	const config = validFile(entry)?.config;
	return config ? [config] : [];
}

export type ConfigNotice =
	| {
			readonly kind: "broken";
			readonly file: string;
			readonly errors: readonly Diagnostic[];
			readonly keptLastValid: boolean;
	  }
	| { readonly kind: "recovered"; readonly file: string }
	| { readonly kind: "added"; readonly file: string }
	| { readonly kind: "removed"; readonly file: string };

export interface ConfigReload {
	readonly changed: readonly string[];
	readonly notices: readonly ConfigNotice[];
}

export interface ConfigSelection {
	readonly entries: readonly ConfigEntry[];
	readonly configs: readonly ResolvedConfig[];
	readonly notes: readonly string[];
	readonly home: string;
	readonly nestedWriters: ReadonlySet<string>;

	requireValid(): Result<ResolvedConfig[], DiagnosticsError>;
}

export interface ReloadableSelection extends ConfigSelection {
	readonly files: ReadonlySet<string>;
	readonly followedFolder: string | undefined;

	reads(file: string): boolean;

	concerns(file: string): boolean;

	reload(files: readonly string[]): Promise<ConfigReload>;
}

export interface ConfigCover {
	readonly file: string;
	readonly whole: boolean;
}

export interface CoveredTargets {
	readonly groups: readonly {
		readonly selection: ReloadableSelection;
		readonly indexes: readonly number[];
		readonly whole: boolean;
	}[];
	readonly uncovered: readonly number[];
}

export interface FailedConfigFile {
	readonly file: string;
	readonly value: unknown;
}

export type ConfigFolderCheck = (
	folder: string,
	files: FileReader
) => Promise<readonly Diagnostic[]>;

export type ConfigFileCheck = (
	failed: FailedConfigFile
) => readonly Diagnostic[];

export interface ConfigService {
	readonly _serviceBrand: undefined;

	select(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>>;
	selectForRojo(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>>;
	selectHere(): Promise<ReloadableSelection>;
	namedConfigs(): Promise<string[]>;
	configsHere(): Promise<string[]>;
	configsIn(folder: string): Promise<string[]>;
	plainProjectsHere(): Promise<string[]>;
	resolveNames(args: readonly string[]): Promise<Result<string[], Error>>;
	referenceTo(file: string, folder: string): Promise<string>;

	firstNotConfig(refs: readonly string[]): Promise<string | undefined>;
	coversOf(target: string): Promise<ConfigCover[]>;
	readersOf(target: string): Promise<string[]>;
	selectCovering(
		targets: readonly (string | undefined)[]
	): Promise<Result<CoveredTargets, Error>>;
	read(file: string): Promise<ConfigEntry>;
	format(file: string): Promise<Result<boolean, Diagnostic[]>>;
	registerFileCheck(check: ConfigFileCheck): Disposable;
	registerFolderCheck(check: ConfigFolderCheck): Disposable;
	staleConfigsIn(folder: string): Promise<readonly Diagnostic[]>;
}

export const ConfigService = createDecorator<ConfigService>("configService");
