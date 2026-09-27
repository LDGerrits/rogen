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
import { DetectedWorkspace, Language } from "./detect-workspace.js";
import {
	DARKLUA_SYNC_DIR,
	InitPlan,
	PlannedFile,
	SCHEMA_URL,
	compiledDirOf,
	configFile,
	existingFileDiagnostics,
	serialize,
	watchCommand,
} from "./init-plan.js";
import { darkluaCommands, tagsStep } from "./init-steps.js";
import { PROJECT_SUFFIX } from "./init-template.js";

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
	/** The language and Darklua of the project the place joins. */
	readonly workspace: DetectedWorkspace;
	/** The absolute directory init writes into. */
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
}

/** The files a place named `name` writes, plus its project file, which mustn't exist either. */
export const placeFileNames = (
	name: string,
	language: Language,
	darklua: boolean
): string[] => [
	`${name}${CONFIG_SUFFIX}`,
	...(language === "luau" && darklua
		? [`${name}-source${CONFIG_SUFFIX}`]
		: []),
	...(language === "roblox-ts" ? [tsconfigFileName(name)] : []),
	`${name}${PROJECT_SUFFIX}`,
];

/** The files a variant named `name` writes, plus its project file. */
export const variantFileNames = (name: string): string[] => [
	`${name}${CONFIG_SUFFIX}`,
	`${name}${PROJECT_SUFFIX}`,
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

const checked = (
	plan: InitPlan,
	{
		directory,
		existingFiles,
	}: Pick<PlacePlanOptions, "directory" | "existingFiles">
): Result<InitPlan, Diagnostic[]> => {
	const existing = existingFileDiagnostics(
		[...plan.configs, ...plan.tsconfigs].map(({ fileName }) => fileName),
		directory,
		existingFiles
	);
	return existing.length > 0 ? err(existing) : ok(plan);
};

export function planPlace(
	options: PlacePlanOptions
): Result<InitPlan, Diagnostic[]> {
	return checked(
		options.workspace.language === "roblox-ts"
			? planRobloxTsPlace(options)
			: planLuauPlace(options),
		options
	);
}

function planLuauPlace({
	choices: { name, folder },
	base,
	workspace,
	directory,
}: PlacePlanOptions): InitPlan {
	const rootDirs = [...base.rootDirs, folder];
	const serve = `rojo serve ${name}${PROJECT_SUFFIX}`;
	const tags = (configStem: string) =>
		tagsStep(workspace.language, `${configStem}${CONFIG_SUFFIX}`);
	const plan = (
		configs: PlannedFile[],
		run: string[],
		darklua: string[],
		tagsStem: string
	): InitPlan => ({
		configs,
		tsconfigs: [],
		notes: [],
		nextSteps: { setup: [], run, darklua, edits: [tags(tagsStem)] },
	});

	if (!workspace.darklua) {
		return plan(
			[
				placeConfig(name, {
					extends: extendsRef(DEFAULT_CONFIG_FILE),
					rootDirs,
				}),
			],
			[watchCommand([name]), serve],
			[],
			name
		);
	}

	const syncDir = `${base.syncDir ?? DARKLUA_SYNC_DIR}/${name}`;
	const darklua = darkluaCommands(directory, rootDirs, syncDir);
	if (!base.parent) {
		return plan(
			[
				placeConfig(name, {
					extends: extendsRef(DEFAULT_CONFIG_FILE),
					rootDirs,
					syncDir,
				}),
			],
			[watchCommand([name]), serve],
			darklua,
			name
		);
	}

	const sourceStem = `${name}-source`;
	return plan(
		[
			placeConfig(sourceStem, {
				extends: extendsRef(base.parent),
				rootDirs,
			}),
			placeConfig(name, {
				extends: extendsRef(`${sourceStem}${CONFIG_SUFFIX}`),
				syncDir,
			}),
		],
		[watchCommand([name, sourceStem]), serve],
		darklua,
		sourceStem
	);
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

	return {
		configs: [
			placeConfig(name, {
				extends: extendsRef(DEFAULT_CONFIG_FILE),
				rootDirs,
				syncDir,
			}),
		],
		tsconfigs: [
			{
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
		],
		notes: [],
		nextSteps: {
			setup: workspace.tsconfigHasInclude
				? []
				: [
						`Add "include": ${JSON.stringify(base.rootDirs)} to tsconfig.json, so its own build leaves out the place folders.`,
					],
			run: [
				`rbxtsc -w -p ${tsconfigFile} --rojo ${name}${PROJECT_SUFFIX}`,
				watchCommand([name]),
				`rojo serve ${name}${PROJECT_SUFFIX}`,
			],
			darklua: workspace.darklua
				? [`darklua process ${outDir} ${syncDir}`]
				: [],
			edits: [tagsStep(workspace.language, `${name}${CONFIG_SUFFIX}`)],
		},
	};
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
				placeConfig(name, {
					extends: extendsRef(DEFAULT_CONFIG_FILE),
				}),
			],
			tsconfigs: [],
			notes: [],
			nextSteps: {
				setup: [],
				run: [
					watchCommand([name]),
					`rojo serve ${name}${PROJECT_SUFFIX}`,
				],
				darklua: [],
				edits: [
					`Turn tags on or off under "tags", or add "exclude", in ${name}${CONFIG_SUFFIX}.`,
				],
			},
		},
		options
	);
}
