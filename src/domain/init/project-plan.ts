import { formatJsonFile } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { RogenConfig, configFileName } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { Darklua } from "../toolchain/darklua.js";
import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { InitChoices } from "./init-choices.js";
import {
	SCHEMA_URL,
	configFile,
	existingFileDiagnostics,
	extendsRef,
	hasSourceConfig,
	outputFileNames,
	placeFolder,
	sourceStemOf,
} from "./init-files.js";
import { InitPlan, NextSteps, tagsStep, watchCommand } from "./init-plan.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { startingRoutes } from "./starting-routes.js";
import {
	TEMPLATE_FILE,
	addMissingMounts,
	handWrittenProjectFiles,
	parseTemplateProject,
	stripGeneratedNodes,
	templateTree,
} from "./template.js";

export interface ProjectPlanOptions {
	readonly choices: InitChoices;
	readonly projectName: string;
	/** The absolute directory init writes into. */
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
	/** The contents of the file a `copy` template choice copies. */
	readonly copiedTemplate?: string;
}

/** The files and steps for a new project; fails when a config it would write already exists. */
export function planProject(
	options: ProjectPlanOptions
): Result<InitPlan, Diagnostic[]> {
	const plan = buildPlan(options);
	const existing = existingFileDiagnostics(
		plan.configs.map(({ fileName }) => fileName),
		options.directory,
		options.existingFiles
	);
	return existing.length > 0 ? err(existing) : ok(plan);
}

const joinList = (items: readonly string[], conjunction: string): string =>
	items.length <= 1
		? items.join("")
		: `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;

function nextSteps(
	{ name, darklua, rootDirs, syncDir, outDir }: InitChoices,
	language: Language,
	directory: string
): NextSteps {
	const { compiler } = language;
	const sourced = hasSourceConfig(language, darklua);
	// Darklua reads the source-rooted project, so both are kept current.
	const watched = sourced ? [name, sourceStemOf(name)] : [name];
	const configName = configFileName(sourced ? sourceStemOf(name) : name);
	const processed = compiler ? [outDir ?? compiler.defaultOutDir] : rootDirs;
	return {
		setup: [],
		run: [
			...(compiler ? [compiler.compileCommand] : []),
			watchCommand(watched),
			`rojo serve ${projectFileName(name)}`,
		],
		darklua:
			darklua && syncDir
				? Darklua.processCommands(directory, processed, syncDir)
				: [],
		edits: [
			`Add your own routes under "routes" in ${configName}.`,
			tagsStep(language, configName),
		],
	};
}

interface PlannedTemplate {
	readonly file?: PlannedFile;
	/** What the configs name as their template. */
	readonly reference?: string;
	readonly notes: readonly string[];
	readonly edits: readonly string[];
}

function planTemplate(
	{ choices, projectName, existingFiles, copiedTemplate }: ProjectPlanOptions,
	language: Language
): PlannedTemplate {
	const { template, mounts, name, darklua, rootDirs, syncDir, places } =
		choices;
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
			edits: [],
		};
	}
	if (template.kind === "copy") {
		return copyTemplate(template.from, copiedTemplate ?? "", choices, [
			...rootDirs,
			...(syncDir ? [syncDir] : []),
			...places.map(placeFolder),
		]);
	}
	if (template.kind === "use") {
		return {
			reference: template.file,
			notes: [`Using ${template.file} as the template.`],
			edits: [],
		};
	}

	const tree = templateTree(mounts);
	if (Object.keys(tree).length === 0) return { notes: [], edits: [] };
	return {
		file: {
			fileName: TEMPLATE_FILE,
			content: formatJsonFile({
				name: projectName,
				tree: { $className: "DataModel", ...tree },
			} satisfies RojoTree),
		},
		reference: TEMPLATE_FILE,
		notes: [],
		edits: [],
	};
}

/** `dirs` are the folders Rogen generates nodes for now, which the copy leaves out. */
function copyTemplate(
	from: string,
	content: string,
	{ mounts }: InitChoices,
	dirs: readonly string[]
): PlannedTemplate {
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
					? formatJsonFile(mounted.project)
					: content,
		},
		reference: TEMPLATE_FILE,
		notes: [
			`Copying ${from} to ${TEMPLATE_FILE}, since Rogen replaces ${from} on every build.`,
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

function buildPlan(options: ProjectPlanOptions): InitPlan {
	const { choices, directory } = options;
	const { name, language, darklua, rootDirs, syncDir, routes, fallback } =
		choices;
	const template = planTemplate(options, language);
	const steps = nextSteps(choices, language, directory);
	const { compiler } = language;

	const starter = (starterSyncDir?: string): RogenConfig => ({
		$schema: SCHEMA_URL,
		rootDirs: [...rootDirs],
		routes: startingRoutes(language, routes, fallback),
		...(template.reference && { template: template.reference }),
		...(starterSyncDir && { syncDir: starterSyncDir }),
	});

	const sourceStem = sourceStemOf(name);
	return {
		template: template.file,
		configs: hasSourceConfig(language, darklua)
			? [
					configFile(sourceStem, starter()),
					configFile(name, {
						$schema: SCHEMA_URL,
						extends: extendsRef(configFileName(sourceStem)),
						...(syncDir && { syncDir }),
					}),
				]
			: [configFile(name, starter(syncDir))],
		compilerConfigs: [],
		notes: [
			...template.notes,
			...(compiler && !darklua && syncDir
				? [
						`Syncing from ${syncDir}, where ${compiler.name} compiles to.`,
					]
				: []),
		],
		nextSteps: { ...steps, edits: [...template.edits, ...steps.edits] },
	};
}
