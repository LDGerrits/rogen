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
import { schemaUrlFor } from "../config/schema-url.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import {
	DEFAULT_OUT_DIR,
	DetectedWorkspace,
	Language,
	PLACES_DIR,
} from "./detect-workspace.js";
import { TemplateMount, defaultMounts, templateTree } from "./init-mounts.js";
import { defaultRootDir } from "./init-root-dirs.js";
import {
	darkluaCommands,
	darkluaSteps,
	tagsStep,
	terminalSteps,
} from "./init-steps.js";
import {
	PROJECT_SUFFIX,
	TEMPLATE_FILE,
	TemplateChoice,
	defaultTemplateChoice,
	handWrittenProjectFiles,
	addMissingMounts,
	parseTemplateProject,
	stripGeneratedNodes,
} from "./init-template.js";
import { DEFAULT_ROUTES, RouteId, startingRoutes } from "./starting-routes.js";

export { TEMPLATE_FILE };

export interface PlannedFile {
	readonly fileName: string;
	readonly content: string;
}

/** What to do after `init`, grouped so a plan can be combined with its places'. */
export interface NextSteps {
	/** One-time edits before anything runs. */
	readonly setup: readonly string[];
	/** Long-running commands, one terminal each. */
	readonly run: readonly string[];
	readonly darklua: readonly string[];
	/** Pointers to what to change in the written files. */
	readonly edits: readonly string[];
}

export const renderSteps = ({
	setup,
	run,
	darklua,
	edits,
}: NextSteps): string[] => [
	...setup,
	...(run.length > 0 ? terminalSteps(run) : []),
	...(darklua.length > 0 ? darkluaSteps(darklua) : []),
	...edits,
];

export interface InitPlan {
	readonly template?: PlannedFile;
	readonly configs: readonly PlannedFile[];
	/** A roblox-ts place's own tsconfig, written after the configs. */
	readonly tsconfigs: readonly PlannedFile[];
	/** Lines printed before the files are written. */
	readonly notes: readonly string[];
	readonly nextSteps: NextSteps;
}

export interface InitChoices {
	readonly name: string;
	readonly language: Language;
	readonly darklua: boolean;
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	/** Where roblox-ts compiles to; Darklua reads it when both are used. */
	readonly outDir?: string;
	readonly template: TemplateChoice;
	readonly mounts: readonly TemplateMount[];
	readonly routes: readonly RouteId[];
	/** Whether files that match no route go to the shared target, or are left out. */
	readonly fallback: boolean;
	/** Places set up alongside, each extending this config from `places/<name>`. */
	readonly places: readonly string[];
}

export interface InitPlanOptions {
	readonly choices: InitChoices;
	readonly projectName: string;
	/** The absolute directory init writes into. */
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
	/** The contents of the file a `copy` template choice copies. */
	readonly copiedTemplate?: string;
}

export const InitDiagnostics = {
	configExists: (location: DiagnosticLocation) =>
		errorDiagnostic(
			"init.configExists",
			location,
			"this config already exists. Delete it to write a new one."
		),
};

export const SCHEMA_URL = schemaUrlFor("2.0.0");
export const DARKLUA_SYNC_DIR = "dist";
export const placeFolder = (name: string): string => `${PLACES_DIR}/${name}`;

export const serialize = (value: unknown): string =>
	`${JSON.stringify(value, null, "\t")}\n`;

const joinList = (items: readonly string[], conjunction: string): string =>
	items.length <= 1
		? items.join("")
		: `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;

export const configFile = (stem: string, config: RogenConfig): PlannedFile => ({
	fileName: `${stem}${CONFIG_SUFFIX}`,
	content: serialize(config),
});

/** The sync dir `init` writes: Darklua's output, or roblox-ts's outDir. */
export function syncDirFor(
	language: Language,
	darklua: boolean,
	workspace: DetectedWorkspace
): string | undefined {
	if (darklua) return DARKLUA_SYNC_DIR;
	return language === "roblox-ts" ? compiledDirOf(workspace) : undefined;
}

export const compiledDirOf = (workspace: DetectedWorkspace): string =>
	workspace.outDir ?? DEFAULT_OUT_DIR;

export const sourceStemOf = (name: string): string =>
	name === DEFAULT_CONFIG_STEM ? "source" : `${name}-source`;

export const hasSourceConfig = (
	language: Language,
	darklua: boolean
): boolean => language === "luau" && darklua;

const configStems = (name: string, language: Language, darklua: boolean) =>
	hasSourceConfig(language, darklua) ? [sourceStemOf(name), name] : [name];

/** Every config file `init` writes for `name`. */
export const configFileNames = (
	name: string,
	language: Language,
	darklua: boolean
): string[] =>
	configStems(name, language, darklua).map(
		(stem) => `${stem}${CONFIG_SUFFIX}`
	);

/** The project files the configs for `name` write, the synced one first. */
export const outputFileNames = (
	name: string,
	language: Language,
	darklua: boolean
): string[] =>
	configStems(name, language, darklua)
		.reverse()
		.map((stem) => `${stem}${PROJECT_SUFFIX}`);

export function defaultInitChoices(
	workspace: DetectedWorkspace,
	name: string,
	existingFiles: ReadonlySet<string>,
	withPlaces: boolean
): InitChoices {
	const { language, darklua } = workspace;
	const syncDir = syncDirFor(language, darklua, workspace);
	const template = defaultTemplateChoice(
		existingFiles,
		outputFileNames(name, language, darklua)
	);
	return {
		name,
		language,
		darklua,
		rootDirs: [defaultRootDir(workspace, language)],
		...(syncDir && { syncDir }),
		...(language === "roblox-ts" && { outDir: compiledDirOf(workspace) }),
		template,
		mounts:
			template.kind === "use" ? [] : defaultMounts(workspace, language),
		routes: DEFAULT_ROUTES,
		fallback: true,
		places: withPlaces ? workspace.places : [],
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
	if (`${name}${PROJECT_SUFFIX}` === TEMPLATE_FILE) {
		return err(
			new Error(
				`"${name}" is not a valid config name: it would write over ${TEMPLATE_FILE}.`
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

export const watchCommand = (names: readonly string[]): string =>
	names.length === 1 && names[0] === DEFAULT_CONFIG_STEM
		? "rogen watch"
		: `rogen watch ${names.join(" ")}`;

function nextSteps(
	{ name, language, darklua, rootDirs, syncDir, outDir }: InitChoices,
	directory: string
): NextSteps {
	// Darklua reads the source-rooted project, so both are kept current.
	const watched = hasSourceConfig(language, darklua)
		? [name, sourceStemOf(name)]
		: [name];
	const routesStem = hasSourceConfig(language, darklua)
		? sourceStemOf(name)
		: name;
	const configName = `${routesStem}${CONFIG_SUFFIX}`;
	return {
		setup: [],
		run: [
			...(language === "roblox-ts" ? ["rbxtsc -w"] : []),
			watchCommand(watched),
			`rojo serve ${name}${PROJECT_SUFFIX}`,
		],
		darklua:
			darklua && syncDir
				? language === "roblox-ts"
					? [
							`darklua process ${outDir ?? DEFAULT_OUT_DIR} ${syncDir}`,
						]
					: darkluaCommands(directory, rootDirs, syncDir)
				: [],
		edits: [
			`Add your own routes under "routes" in ${configName}.`,
			tagsStep(language, configName),
		],
	};
}

function templateOf({
	choices,
	projectName,
	existingFiles,
	copiedTemplate,
}: InitPlanOptions): {
	file?: PlannedFile;
	reference?: string;
	notes: string[];
	edits?: string[];
} {
	const {
		template,
		mounts,
		name,
		language,
		darklua,
		rootDirs,
		syncDir,
		places,
	} = choices;
	if (existingFiles.has(TEMPLATE_FILE)) {
		const handWritten = handWrittenProjectFiles(existingFiles);
		const replaced = outputFileNames(name, language, darklua).filter(
			(file) => handWritten.includes(file)
		);
		return {
			reference: TEMPLATE_FILE,
			notes: [
				`Using ${TEMPLATE_FILE}.`,
				...replaced.map(
					(file) =>
						`Rogen replaces ${file} on every build; move anything you need from it into ${TEMPLATE_FILE} first.`
				),
			],
		};
	}
	if (template.kind === "copy") {
		const content = copiedTemplate ?? "";
		const dirs = [
			...rootDirs,
			...(syncDir ? [syncDir] : []),
			...places.map(placeFolder),
		];
		const copying = `Copying ${template.from} to ${TEMPLATE_FILE}, since Rogen replaces ${template.from} on every build.`;
		const project = parseTemplateProject(content);
		const stripped = project && stripGeneratedNodes(project, dirs);
		const mounted =
			project && addMissingMounts(stripped?.project ?? project, mounts);
		const removed = stripped?.removed ?? [];
		const added = mounted?.added ?? [];
		const skipped = mounted?.skipped ?? [];
		return {
			file: {
				fileName: TEMPLATE_FILE,
				// Rewriting would drop comments and formatting, so only do it when something changed.
				content:
					mounted && removed.length + added.length > 0
						? serialize(mounted.project)
						: content,
			},
			reference: TEMPLATE_FILE,
			notes: [
				copying,
				...(removed.length > 0
					? [
							`Left out ${joinList(removed, "and")}, since ${removed.length === 1 ? "it points" : "they point"} into ${joinList(dirs, "or")} and Rogen generates that code now.`,
						]
					: []),
				...(added.length > 0
					? [`Added ${joinList(added, "and")} to ${TEMPLATE_FILE}.`]
					: []),
				...(skipped.length > 0
					? [
							`Didn't add ${joinList(skipped, "and")} to ${TEMPLATE_FILE}, since it already has ${skipped.length === 1 ? "a node" : "nodes"} there.`,
						]
					: []),
			],
			edits: [
				...(stripped
					? []
					: [
							`Remove the nodes in ${TEMPLATE_FILE} that point into ${joinList(dirs, "or")}; Rogen generates those now.`,
						]),
				...(project || mounts.length === 0
					? []
					: [
							`Mount ${joinList(
								mounts.map(({ path }) => path),
								"and"
							)} in ${TEMPLATE_FILE}; Rogen couldn't read it to add the ${mounts.length === 1 ? "mount" : "mounts"}.`,
						]),
			],
		};
	}
	if (template.kind === "use") {
		return {
			reference: template.file,
			notes: [`Using ${template.file} as the template.`],
		};
	}

	const tree = templateTree(mounts);
	if (Object.keys(tree).length === 0) return { notes: [] };
	return {
		file: {
			fileName: TEMPLATE_FILE,
			content: serialize({
				name: projectName,
				tree: { $className: "DataModel", ...tree },
			} satisfies RojoTree),
		},
		reference: TEMPLATE_FILE,
		notes: [],
	};
}

function buildPlan(options: InitPlanOptions): InitPlan {
	const { name, language, darklua, rootDirs, syncDir, routes, fallback } =
		options.choices;
	const template = templateOf(options);
	const steps = nextSteps(options.choices, options.directory);
	const notes = [
		...template.notes,
		...(language === "roblox-ts" && !darklua && syncDir
			? [`Syncing from ${syncDir}, where roblox-ts compiles to.`]
			: []),
	];

	const starter = (starterSyncDir?: string): RogenConfig => ({
		$schema: SCHEMA_URL,
		rootDirs: [...rootDirs],
		routes: startingRoutes(language, routes, fallback),
		...(template.reference && { template: template.reference }),
		...(starterSyncDir && { syncDir: starterSyncDir }),
	});

	const common = {
		template: template.file,
		tsconfigs: [],
		notes,
		nextSteps: {
			...steps,
			edits: [...(template.edits ?? []), ...steps.edits],
		},
	};

	if (hasSourceConfig(language, darklua)) {
		const sourceStem = sourceStemOf(name);
		return {
			...common,
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

	return { ...common, configs: [configFile(name, starter(syncDir))] };
}
