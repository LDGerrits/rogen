import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { toPosix } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { loadConfigChain } from "../config/config-chain.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
} from "../config/config-discovery.js";
import { RogenConfig } from "../config/config.js";
import { layerConfig } from "../config/config-layers.js";
import { DetectedWorkspace } from "./detect-workspace.js";
import {
	DARKLUA_SYNC_DIR,
	InitPlan,
	PlannedFile,
	SCHEMA_URL,
	compiledDirOf,
	configFile,
	existingFileDiagnostics,
	serialize,
	tagsStep,
} from "./init-plan.js";

export const DEFAULT_CONFIG_FILE = `${DEFAULT_CONFIG_STEM}${CONFIG_SUFFIX}`;

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
	readonly workspace: DetectedWorkspace;
	/** The absolute directory init writes into. */
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
}

/** The files a place named `name` may write. */
export const placeFileNames = (
	name: string,
	workspace: DetectedWorkspace
): string[] => [
	`${name}${CONFIG_SUFFIX}`,
	...(workspace.language === "luau" && workspace.darklua
		? [`${name}-source${CONFIG_SUFFIX}`]
		: []),
	...(workspace.language === "roblox-ts" ? [tsconfigFileName(name)] : []),
];

const tsconfigFileName = (name: string) => `tsconfig.${name}.json`;

export async function readBaseConfig(
	fileSystem: FileSystemService,
	directory: string
): Promise<Result<BaseConfig, Diagnostic[]>> {
	const chain = await loadConfigChain(
		fileSystem,
		path.join(directory, DEFAULT_CONFIG_FILE)
	);
	if (chain.diagnostics.length > 0) return err([...chain.diagnostics]);

	const { config } = layerConfig(chain.layers, { tags: {} }, directory);
	const relative = (absolute: string) =>
		toPosix(path.relative(directory, absolute));
	const syncDir = config.getValue<string | undefined>("syncDir");
	const parent = chain.layers[1]?.file;
	return ok({
		rootDirs: config.getValue<string[]>("rootDirs").map(relative),
		...(syncDir && { syncDir: relative(syncDir) }),
		...(parent && { parent: relative(parent) }),
	});
}

const placeConfig = (stem: string, config: RogenConfig): PlannedFile =>
	configFile(stem, { $schema: SCHEMA_URL, ...config });

const extendsRef = (file: string): string => `./${file}`;

export function planPlace(
	options: PlacePlanOptions
): Result<InitPlan, Diagnostic[]> {
	const plan =
		options.workspace.language === "roblox-ts"
			? planRobloxTsPlace(options)
			: planLuauPlace(options);
	const existing = existingFileDiagnostics(
		[
			...plan.configs.map(({ fileName }) => fileName),
			...(plan.tsconfig ? [plan.tsconfig.fileName] : []),
		],
		options.directory,
		options.existingFiles
	);
	return existing.length > 0 ? err(existing) : ok(plan);
}

function planLuauPlace({
	choices: { name, folder },
	base,
	workspace,
}: PlacePlanOptions): InitPlan {
	const rootDirs = [...base.rootDirs, folder];
	const steps = [`rogen watch ${name}`, `rojo serve ${name}.project.json`];
	const tags = (configStem: string) =>
		tagsStep(workspace.language, `${configStem}${CONFIG_SUFFIX}`);

	if (!workspace.darklua) {
		return {
			configs: [
				placeConfig(name, {
					extends: extendsRef(DEFAULT_CONFIG_FILE),
					rootDirs,
				}),
			],
			nextSteps: [...steps, tags(name)],
		};
	}

	const syncDir = `${base.syncDir ?? DARKLUA_SYNC_DIR}/${name}`;
	const darkluaStep = `Darklua must also process ${folder} into ${syncDir}.`;
	if (!base.parent) {
		return {
			configs: [
				placeConfig(name, {
					extends: extendsRef(DEFAULT_CONFIG_FILE),
					rootDirs,
					syncDir,
				}),
			],
			nextSteps: [...steps, darkluaStep, tags(name)],
		};
	}

	const sourceStem = `${name}-source`;
	return {
		configs: [
			placeConfig(sourceStem, {
				extends: extendsRef(base.parent),
				rootDirs,
			}),
			placeConfig(name, {
				extends: extendsRef(`${sourceStem}${CONFIG_SUFFIX}`),
				syncDir,
			}),
		],
		nextSteps: [...steps, darkluaStep, tags(sourceStem)],
	};
}

function planRobloxTsPlace({
	choices: { name, folder },
	base,
	workspace,
}: PlacePlanOptions): InitPlan {
	const rootDirs = [...base.rootDirs, folder];
	const outDir = `${compiledDirOf(workspace)}/${name}`;
	const syncDir = `${base.syncDir ?? compiledDirOf(workspace)}/${name}`;
	const tsconfigFile = tsconfigFileName(name);

	const steps = [
		...(workspace.tsconfigHasInclude
			? []
			: [
					`Add "include": ${JSON.stringify(base.rootDirs)} to tsconfig.json, so its build skips ${folder}.`,
				]),
		`rbxtsc -w -p ${tsconfigFile} --rojo ${name}.project.json`,
		`rogen watch ${name}`,
		`rojo serve ${name}.project.json`,
		...(workspace.darklua
			? [`Darklua must also process ${outDir} into ${syncDir}.`]
			: []),
		tagsStep(workspace.language, `${name}${CONFIG_SUFFIX}`),
	];

	return {
		configs: [
			placeConfig(name, {
				extends: extendsRef(DEFAULT_CONFIG_FILE),
				rootDirs,
				syncDir,
			}),
		],
		tsconfig: {
			fileName: tsconfigFile,
			content: serialize({
				extends: "./tsconfig.json",
				compilerOptions: {
					rootDir: null,
					rootDirs,
					outDir,
					...(workspace.tsBuildInfoFile && {
						tsBuildInfoFile: `${outDir}/tsconfig.tsbuildinfo`,
					}),
				},
				include: rootDirs,
			}),
		},
		nextSteps: steps,
	};
}
