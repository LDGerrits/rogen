import path from "path";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
} from "../config/config-discovery.js";
import { RogenConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import {
	DEFAULT_OUT_DIR,
	DetectedWorkspace,
	Language,
} from "./detect-workspace.js";
import { TemplateMount, defaultMounts, templateTree } from "./init-mounts.js";
import { defaultRootDir } from "./init-root-dirs.js";
import { DEFAULT_ROUTES, RouteId, startingRoutes } from "./starting-routes.js";

export interface PlannedFile {
	readonly fileName: string;
	readonly content: string;
}

export interface InitPlan {
	readonly template?: PlannedFile;
	readonly configs: readonly PlannedFile[];
	readonly nextSteps: readonly string[];
}

export interface InitChoices {
	readonly name: string;
	readonly language: Language;
	readonly darklua: boolean;
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	readonly mounts: readonly TemplateMount[];
	readonly routes: readonly RouteId[];
	/** Whether files that match no route go to the shared target, or are left out. */
	readonly fallback: boolean;
}

export interface InitPlanOptions {
	readonly choices: InitChoices;
	readonly projectName: string;
	/** The absolute directory init writes into. */
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
}

export const InitDiagnostics = {
	configExists: (location: DiagnosticLocation) =>
		errorDiagnostic(
			"init.configExists",
			location,
			"this config already exists. Delete it to write a new one."
		),
};

const SCHEMA_URL = "https://rogen.dev/schema/2/rogen.json";
export const TEMPLATE_FILE = "template.project.json";
const DARKLUA_SYNC_DIR = "dist";

const serialize = (value: unknown): string =>
	`${JSON.stringify(value, null, "\t")}\n`;

const configFile = (stem: string, config: RogenConfig): PlannedFile => ({
	fileName: `${stem}${CONFIG_SUFFIX}`,
	content: serialize(config),
});

export function syncDirFor(
	language: Language,
	darklua: boolean,
	workspace: DetectedWorkspace
): string | undefined {
	if (darklua) return DARKLUA_SYNC_DIR;
	return language === "roblox-ts"
		? (workspace.outDir ?? DEFAULT_OUT_DIR)
		: undefined;
}

export const sourceStemOf = (name: string): string =>
	name === DEFAULT_CONFIG_STEM ? "source" : `${name}-source`;

const hasSourceConfig = (language: Language, darklua: boolean): boolean =>
	language === "luau" && darklua;

/** Every config file `init` writes for `name`. */
export function configFileNames(
	name: string,
	language: Language,
	darklua: boolean
): string[] {
	const stems = hasSourceConfig(language, darklua)
		? [sourceStemOf(name), name]
		: [name];
	return stems.map((stem) => `${stem}${CONFIG_SUFFIX}`);
}

export function defaultInitChoices(
	workspace: DetectedWorkspace,
	name: string
): InitChoices {
	const { language, darklua } = workspace;
	const syncDir = syncDirFor(language, darklua, workspace);
	return {
		name,
		language,
		darklua,
		rootDirs: [defaultRootDir(workspace, language)],
		...(syncDir && { syncDir }),
		mounts: defaultMounts(workspace, language),
		routes: DEFAULT_ROUTES,
		fallback: true,
	};
}

/** `names` are the positionals after `init`. */
export function parseInitName(names: readonly string[]): Result<string, Error> {
	if (names.length > 1) {
		return err(new Error("init takes at most one config name."));
	}
	const [name = DEFAULT_CONFIG_STEM] = names;
	if (name.trim() === "") {
		return err(new Error("A config name can't be empty."));
	}
	if (name === "." || name === ".." || /[\\/]/.test(name)) {
		return err(
			new Error(
				`"${name}" is not a valid config name: it can't contain path separators.`
			)
		);
	}
	return ok(name);
}

/** One diagnostic per file in `fileNames` that already exists in `directory`. */
export const existingFileDiagnostics = (
	fileNames: readonly string[],
	directory: string,
	existingFiles: ReadonlySet<string>
): Diagnostic[] =>
	fileNames
		.filter((fileName) => existingFiles.has(fileName))
		.map((fileName) =>
			InitDiagnostics.configExists({
				resource: path.join(directory, fileName),
			})
		);

export function planInit(
	options: InitPlanOptions
): Result<InitPlan, Diagnostic[]> {
	const plan = buildPlan(options);
	const existing = existingFileDiagnostics(
		plan.configs.map(({ fileName }) => fileName),
		options.directory,
		options.existingFiles
	);
	return existing.length > 0 ? err(existing) : ok(plan);
}

function nextSteps({
	name,
	language,
	darklua,
	rootDirs,
	syncDir,
}: InitChoices): string[] {
	const steps = [
		...(language === "roblox-ts" ? ["rbxtsc -w"] : []),
		name === DEFAULT_CONFIG_STEM ? "rogen watch" : `rogen watch ${name}`,
		`rojo serve ${name}.project.json`,
	];
	if (darklua && syncDir) {
		steps.push(
			`Darklua must process each root dir into ${syncDir} (darklua process ${rootDirs[0]} ${syncDir}).`
		);
	}
	steps.push(
		`Add your own routes under "routes" in ${name}${CONFIG_SUFFIX}.`
	);
	return steps;
}

function buildPlan(options: InitPlanOptions): InitPlan {
	const {
		name,
		language,
		darklua,
		rootDirs,
		syncDir,
		mounts,
		routes,
		fallback,
	} = options.choices;
	const tree = templateTree(mounts);
	const hasMounts = Object.keys(tree).length > 0;
	const templateExists = options.existingFiles.has(TEMPLATE_FILE);

	const template: PlannedFile | undefined =
		hasMounts && !templateExists
			? {
					fileName: TEMPLATE_FILE,
					content: serialize({
						name: options.projectName,
						tree: {
							$className: "DataModel",
							...tree,
						},
					} satisfies RojoTree),
				}
			: undefined;

	const starter = (starterSyncDir?: string): RogenConfig => ({
		$schema: SCHEMA_URL,
		rootDirs: [...rootDirs],
		routes: startingRoutes(language, routes, fallback),
		...((hasMounts || templateExists) && {
			template: TEMPLATE_FILE,
		}),
		...(starterSyncDir && { syncDir: starterSyncDir }),
	});

	const steps = nextSteps(options.choices);

	if (hasSourceConfig(language, darklua)) {
		const sourceStem = sourceStemOf(name);
		return {
			template,
			nextSteps: steps,
			configs: [
				configFile(sourceStem, starter()),
				configFile(name, {
					$schema: SCHEMA_URL,
					extends: `${sourceStem}${CONFIG_SUFFIX}`,
					...(syncDir && { syncDir }),
				}),
			],
		};
	}

	return {
		template,
		configs: [configFile(name, starter(syncDir))],
		nextSteps: steps,
	};
}
