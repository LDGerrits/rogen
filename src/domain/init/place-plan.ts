import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { RogenConfig, configFileName } from "../config/config.js";
import { ConfigEntry } from "../config/config-service.js";
import { projectFileName } from "../rojo/rojo-project.js";
import {
	Darklua,
	DetectedWorkspace,
	Language,
	PlannedFile,
} from "../toolchain/toolchain.js";
import {
	DEFAULT_CONFIG_FILE,
	SCHEMA_URL,
	configFile,
	existingFileDiagnostics,
	extendsRef,
} from "./init-files.js";
import { ConfigSet } from "./config-set.js";
import { InitPlan, tagsStep, watchCommand } from "./init-plan.js";

export interface PlaceChoices {
	readonly name: string;
	readonly folder: string;
}

/** What a place inherits from `default.rogen.json`, with paths relative to the working directory. */
export interface BaseConfig {
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	/** The config `default` extends, which holds the shared source setup of a Darklua repo. */
	readonly parent?: string;
}

export interface PlacePlanOptions {
	readonly choices: PlaceChoices;
	readonly base: BaseConfig;
	/** The language of the project the place joins. */
	readonly language: Language;
	/** Whether Darklua processes the project the place joins. */
	readonly darklua: boolean;
	/** The detected facts; its own language and Darklua flag give way to the two above. */
	readonly workspace: DetectedWorkspace;
	/** The absolute directory init writes into. */
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
}

/** What a place inherits from `entry`, `default.rogen.json` in `directory` resolved the way a build would, so a place joins a config that builds. */
export function baseConfigOf(
	entry: ConfigEntry,
	directory: string
): Result<BaseConfig, Diagnostic[]> {
	if (!entry.resolved) return err([...entry.diagnostics]);

	const relative = (absolute: string) =>
		toPosix(path.relative(directory, absolute));
	const { rootDirs, syncDir } = entry.resolved;
	const parent = entry.chain[1];
	return ok({
		rootDirs: rootDirs.map(relative),
		...(syncDir && { syncDir: relative(syncDir) }),
		...(parent && { parent: relative(parent) }),
	});
}

const placeConfig = (stem: string, config: RogenConfig): PlannedFile =>
	configFile(stem, { $schema: SCHEMA_URL, ...config });

const checked = (
	plan: InitPlan,
	{
		directory,
		existingFiles,
	}: Pick<PlacePlanOptions, "directory" | "existingFiles">
): Result<InitPlan, Diagnostic[]> => {
	const existing = existingFileDiagnostics(
		[...plan.configs, ...plan.compilerConfigs].map(
			({ fileName }) => fileName
		),
		directory,
		existingFiles
	);
	return existing.length > 0 ? err(existing) : ok(plan);
};

/**
 * A place extends `default.rogen.json` and adds its own folder to the root
 * dirs. When code is compiled or processed before Rojo syncs it, the place
 * syncs from its own subfolder of the sync dir; plain Luau syncs from the
 * root dirs themselves.
 */
export function planPlace(
	options: PlacePlanOptions
): Result<InitPlan, Diagnostic[]> {
	const {
		choices: { name, folder },
		base,
		language,
		darklua,
		directory,
	} = options;
	const workspace: DetectedWorkspace = {
		...options.workspace,
		language: language.id,
		darklua,
	};
	const { compiler } = language;
	const configSet = new ConfigSet(name, language, darklua);
	const rootDirs = [...base.rootDirs, folder];
	const projectFile = projectFileName(name);

	const outDir = compiler && `${compiler.outDir(workspace)}/${name}`;
	const syncBase =
		compiler || darklua
			? (base.syncDir ??
				compiler?.outDir(workspace) ??
				Darklua.defaultSyncDir)
			: undefined;
	const syncDir = syncBase && `${syncBase}/${name}`;
	const compiled =
		compiler &&
		outDir &&
		compiler.planPlace({
			name,
			rootDirs,
			sharedRootDirs: base.rootDirs,
			outDir,
			projectFile,
			workspace,
		});

	const { sourceStem } = configSet;
	const sourced = configSet.sourced && base.parent;
	const configs = sourced
		? [
				placeConfig(sourceStem, {
					extends: extendsRef(sourced),
					rootDirs,
				}),
				placeConfig(name, {
					extends: extendsRef(configFileName(sourceStem)),
					syncDir,
				}),
			]
		: [
				placeConfig(name, {
					extends: extendsRef(DEFAULT_CONFIG_FILE),
					rootDirs,
					...(syncDir && { syncDir }),
				}),
			];

	return checked(
		{
			configs,
			compilerConfigs: compiled ? compiled.files : [],
			notes: [],
			nextSteps: {
				setup: compiled ? compiled.setup : [],
				run: [
					...(compiled ? [compiled.compileCommand] : []),
					watchCommand(sourced ? [name, sourceStem] : [name]),
					`rojo serve ${projectFile}`,
				],
				darklua:
					darklua && syncDir
						? Darklua.processCommands(
								directory,
								outDir ? [outDir] : rootDirs,
								syncDir
							)
						: [],
				edits: [
					tagsStep(
						language,
						configFileName(sourced ? sourceStem : name)
					),
				],
			},
		},
		options
	);
}

export interface VariantPlanOptions {
	readonly name: string;
	readonly directory: string;
	readonly existingFiles: ReadonlySet<string>;
}

/** A variant inherits everything from default; its own file is where tags and excludes go. */
export function planVariant(
	options: VariantPlanOptions
): Result<InitPlan, Diagnostic[]> {
	const { name } = options;
	return checked(
		{
			configs: [
				placeConfig(name, { extends: extendsRef(DEFAULT_CONFIG_FILE) }),
			],
			compilerConfigs: [],
			notes: [],
			nextSteps: {
				setup: [],
				run: [
					watchCommand([name]),
					`rojo serve ${projectFileName(name)}`,
				],
				darklua: [],
				edits: [
					`Turn tags on or off under "tags", or add "exclude", in ${configFileName(name)}.`,
				],
			},
		},
		options
	);
}
