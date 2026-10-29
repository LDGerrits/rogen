import path from "path";
import { UsageError } from "../../base/errors.js";
import { containsPosix, normalizeDir } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT_FILE,
	RogenConfig,
	configFileName,
} from "../config/config.js";
import {
	Darklua,
	Language,
	Mount,
	PlannedFile,
} from "../toolchain/toolchain.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { DerivedRoutes } from "./derived-routes.js";
import { GreeterSample } from "./greeter-sample.js";
import { SAMPLE_GAME_FOLDER, SampleGame } from "./sample-game.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import {
	OutputConfigs,
	PROCESSED_OUTPUT,
	RELEASE_OUTPUT,
} from "./output-configs.js";
import { InitQuestions } from "./init-questions.js";
import { InitKind, PlannedCommand, PlannedScaffold } from "./init-service.js";
import { ProjectFiles } from "./project-files.js";
import { ProjectTemplate } from "./project-template.js";
import { StarterProject } from "./starter-project.js";
import { ProjectReader } from "./project-reader.js";
import { Setup } from "./setup.js";
import { RobloxTsStarter } from "./roblox-ts-starter.js";
import { StartingRoutes } from "./starting-routes.js";
import {
	PROJECTS_FOLDER,
	StarterPlaces,
	StartingPlaces,
} from "./starter-places.js";
import { ProcessedFolder } from "./processed-folder.js";
import { MountedCode } from "./mounted-code.js";
import { CodeFinder } from "./code-finder.js";
import { UnmountedFiles } from "./unmounted-files.js";
import { ProjectTree, TreeChoice, TreePlan } from "./tree-plan.js";

export interface ProjectChoices {
	readonly language: Language;
	readonly sourcePaths: readonly string[];
	readonly compiledPath?: string;
	/** The folder a processor writes, which the lifted project file mounts; `config` is the processor's config file, without which those mounts stay. */
	readonly processed?: { readonly folder: string; readonly config?: string };
	readonly tree: ProjectTree;
	readonly mounts: readonly Mount[];
	/** Folders of code the lifted project file mounts, which no source path holds and the tree keeps mounting. */
	readonly keptCode?: readonly string[];
	/** Folders and files of code that no source path holds and the tree doesn't mount, which Rogen places nowhere. */
	readonly outside?: readonly string[];
	/** Files of the source paths that the lifted project file mounts nowhere, which Rojo ignored and routes will place. */
	readonly unmounted?: readonly string[];
	/** The template of a new project; its files and git step are left out when none is given. */
	readonly kind?: InitKind;
	readonly skipGit?: boolean;
	/** The files of the template that are not there yet, which `init` writes. */
	readonly templateFiles?: readonly PlannedFile[];
	/** Whether the Greeter sample is written. */
	readonly sample?: boolean;
	/** The places a project of several starts with. */
	readonly places?: StartingPlaces;
	/** The tool that writes the project's own files first, and what runs once the files are in. */
	readonly scaffold?: {
		readonly tool: PlannedScaffold;
		readonly after: readonly PlannedCommand[];
	};
	/** What to add to it so git leaves the project files Rogen writes out. */
	readonly projectFilesHint?: string;
}

function derivedRoutesOf(
	tree: ProjectTree,
	dirs: readonly string[]
): DerivedRoutes | undefined {
	return tree.kind === "lift"
		? DerivedRoutes.of(tree.project, dirs)
		: undefined;
}

/** The folders placed as they are: the language's own, and the packages that are installed or that a manifest says are coming. */
function mountsOf(directory: InitDirectory, language: Language): Mount[] {
	return [
		...language.alwaysMounted(),
		...[
			...directory.workspace.packageMounts(language),
			...language.offeredMounts(),
		].filter(({ ticked }) => ticked),
	].map(({ path, installed, landing }) => ({
		path,
		optional: !installed,
		landing,
	}));
}

/** Whether routes can place code in the tree: a lifted file whose root isn't a DataModel, such as a model or plugin, is Rojo's own and has no service to route to. */
function takesRoutes(tree: ProjectTree): boolean {
	return (
		tree.kind === "new" ||
		(tree.kind === "lift" && tree.project.takesRoutes)
	);
}

const BUILD_COMMANDS: Readonly<Record<InitKind, (name: string) => string>> = {
	place: (name) => `rogen build -o "${name}.rbxlx"`,
	model: (name) => `rogen build -o "${name}.rbxmx"`,
	plugin: (name) => `rogen build -p "${name}.rbxm"`,
};

function generatedDirs({
	sourcePaths,
	compiledPath,
	processed,
}: Pick<
	ProjectChoices,
	"sourcePaths" | "compiledPath" | "processed"
>): string[] {
	return [
		...sourcePaths,
		...(compiledPath ? [compiledPath] : []),
		...(processed?.config ? [processed.folder] : []),
	];
}

/** The folder the processed config reads, when a processor's config says one writes it. */
function processedPathOf({ processed }: ProjectChoices): string | undefined {
	return processed?.config ? processed.folder : undefined;
}

const UNMOUNTED_SHOWN = 5;

const LIFTED_HERE = `${DEFAULT_PROJECT_FILE} is here, which init lifts.`;

export class ProjectSetup implements Setup<ProjectChoices> {
	private readonly files: ProjectFiles;

	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		private readonly fileSystemService: FileReader
	) {
		this.files = new ProjectFiles(fileSystemService, directory.path);
	}

	async ask(): Promise<Result<ProjectChoices | undefined, Diagnostic[]>> {
		const { directory, questions } = this;
		const kind = questions.kind();
		const tree = await this.resolveTree(questions.tree(directory), kind);
		if (tree.isErr()) return tree;
		const picked = await questions.language(directory);
		if (picked === undefined) return ok(undefined);
		const starter = this.starterFor(kind, picked);
		const language = starter ? (picked.scaffolded?.() ?? picked) : picked;

		const several = await this.severalPlaces(
			kind,
			language,
			starter !== undefined
		);
		if (several === undefined) return ok(undefined);
		const places = several
			? await new StarterPlaces(this.fileSystemService).plan(
					directory.path,
					starter
				)
			: undefined;
		const taken = places ? await this.placeTaken(places) : undefined;
		if (taken) return err([taken]);

		const compiledPath = language.compiler?.outDir;
		const routed = takesRoutes(tree.value);
		const lifted =
			routed && tree.value.kind === "lift"
				? tree.value.project
				: undefined;
		const code =
			lifted && !language.compiler
				? await new MountedCode(
						this.fileSystemService,
						directory.path
					).find(
						lifted.mountedFolders(),
						[...directory.workspace.packageDirs],
						directory.layout.codeFolders
					)
				: undefined;
		const sourcePaths = places
			? [...places.sourcePaths]
			: !routed
				? []
				: code && code.sourcePaths.length > 0
					? [...code.sourcePaths]
					: [directory.defaultSourcePath(language)];

		const processedFolder = code
			? code.processed
			: lifted
				? await new ProcessedFolder(
						this.fileSystemService,
						directory.path
					).find(
						sourcePaths,
						lifted.mountedFolders(),
						compiledPath ? [compiledPath] : []
					)
				: undefined;
		const processorConfig = directory.workspace.darkluaConfig;
		const processed = processedFolder
			? {
					folder: processedFolder,
					...(processorConfig && { config: processorConfig }),
				}
			: undefined;
		const mounted = routed ? mountsOf(directory, language) : [];
		const mounts = places
			? StarterPlaces.mountsFor(
					places,
					mounted,
					RobloxTsStarter.OWN_FOLDERS
				)
			: mounted;

		const unmounted = lifted
			? await new UnmountedFiles(
					this.fileSystemService,
					directory.path
				).find(
					sourcePaths,
					lifted.mountedFolders(),
					lifted.toConfig().globIgnorePaths ?? [],
					[compiledPath, processedFolder].filter(
						(folder) => folder !== undefined
					)
				)
			: [];

		const keptCode =
			code && !code.processed
				? code.folders.filter(
						(folder) =>
							!sourcePaths.some((sourcePath) =>
								containsPosix(sourcePath, folder)
							)
					)
				: [];

		const outside = routed
			? await new CodeFinder(this.fileSystemService).codeOutside(
					directory.path,
					[...sourcePaths, ...(lifted?.mountedFolders() ?? [])].map(
						normalizeDir
					),
					[
						...directory.workspace.packageDirs,
						...language.reservedFolders,
						compiledPath,
						processedFolder,
					]
						.filter((folder) => folder !== undefined)
						.map(normalizeDir)
				)
			: [];

		const sample = this.wantsSample(
			kind,
			tree.value,
			language,
			starter !== undefined
		);
		const sampleOf = new GreeterSample(
			language,
			path.basename(directory.path)
		);
		const game = sample
			? new SampleGame(places?.gameFolder ?? SAMPLE_GAME_FOLDER)
			: undefined;
		const sampleFiles = game
			? [
					...sampleOf.feature(
						places?.commonSourcePath ?? sourcePaths[0]
					),
					...(places ? sampleOf.place(places.placeSourcePath) : []),
					...game.written(places?.folder ?? ""),
					sampleOf.readme(
						places?.commonSourcePath ?? sourcePaths[0],
						ProjectSetup.serveCommand(places),
						places?.place
					),
				]
			: [];

		const skipGit = questions.skipGit();
		return ok({
			language,
			sourcePaths: [...sourcePaths],
			...(compiledPath && { compiledPath }),
			...(processed && { processed }),
			tree:
				game && tree.value.kind === "new"
					? { ...tree.value, game }
					: tree.value,
			mounts,
			keptCode,
			outside,
			unmounted,
			kind,
			skipGit,
			sample,
			...(places && { places }),
			...(starter && {
				scaffold: {
					tool: starter.scaffold(places !== undefined),
					after: places ? [starter.scripts(places.folder)] : [],
				},
			}),
			projectFilesHint: await this.files.projectFilesHint(),
			templateFiles: await this.absent([
				...ProjectSetup.templateFiles(
					new ProjectTemplate(
						kind,
						path.basename(directory.path),
						starter
							? RobloxTsStarter.ignored(places !== undefined)
							: []
					),
					tree.value,
					skipGit
				),
				...sampleFiles,
				...(places?.files ?? []),
			]),
		});
	}

	/** The command that serves the project: a place by its folder or name, and the processed config by its name. */
	private static serveCommand(
		places: StartingPlaces | undefined,
		processedPath?: string
	): string {
		if (places) return `rogen serve ${places.place}`;
		return processedPath
			? `rogen serve ${PROCESSED_OUTPUT}`
			: "rogen serve";
	}

	/** How to add a second place, which `init` starts but never adds; `game`: whether the first place has the sample game, which the second copies. */
	private static addPlaceStep(places: StartingPlaces, game: boolean): string {
		const port = "from a second terminal with its own --port";
		if (places.folder === "") {
			const { outputPrefix, gameFolder } = places;
			const lobby = (file: string) =>
				file.replace(outputPrefix, "lobby.");
			const release = configFileName(`${outputPrefix}${RELEASE_OUTPUT}`);
			const lobbyGame = path.posix.join(
				path.posix.dirname(gameFolder),
				"lobby"
			);
			const edited =
				'Give the copy its own "name" and source path: Rogen errors while it is still the same config, or has the same name and no source path in common.';
			const copy = game
				? `copy ${places.configFile} to ${lobby(places.configFile)}, point each ${gameFolder} in its tree to ${lobbyGame}, make src/lobby and copy ${gameFolder} to ${lobbyGame}. ${edited}`
				: `copy ${places.configFile} to ${lobby(places.configFile)} and make src/lobby. ${edited}`;
			return `Add another place: ${copy} Do the same for ${release} if there is one. Serve it ${port}: 'rogen serve lobby --port <port>'.`;
		}
		const lobby = `${PROJECTS_FOLDER}/lobby`;
		const copied = [
			`${places.folder}/${DEFAULT_CONFIG_FILE}`,
			`${places.folder}/tsconfig.json`,
			...(game ? [`${places.folder}/${places.gameFolder}`] : []),
		];
		return `Add another place: make ${lobby}/src, copy ${joinedWithAnd(copied)} into ${lobby} (with the release config, if the place has one), and change the "name" in each config to lobby. Run 'rogen write ${lobby}' for its project file, add 'rbxtsc -p ${lobby}' and 'rbxtsc -w -p ${lobby}' to the build and watch scripts in package.json, and serve it ${port}: 'rogen serve ${lobby} --port <port>'.`;
	}

	/** An error when the first place has a config already, which init never overwrites. */
	private async placeTaken(
		places: StartingPlaces
	): Promise<Diagnostic | undefined> {
		const file = path.join(this.directory.path, places.configFile);
		return (await this.fileSystemService.exists(file))
			? errorDiagnostic(
					"init.configExists",
					{ resource: file },
					"this config already exists, and init never overwrites one."
				)
			: undefined;
	}

	/** Why a new project can't be several places, which `--places` would be an error for. */
	private noPlacesBecause(
		kind: InitKind,
		language: Language,
		scaffolded: boolean
	): string | undefined {
		if (kind !== "place") return `is for a place, not for a ${kind}.`;
		const later =
			"Start with one place, then add more by hand, as the places guide shows.";
		if (language.compiler && !scaffolded)
			return `starts a new ${language.copy.label} project with places, and this folder already has one. ${later}`;
		if (this.directory.hasHandWrittenProject)
			return `starts a new tree, and ${LIFTED_HERE} Move ${DEFAULT_PROJECT_FILE} away first, or leave --places out.`;
		return undefined;
	}

	/** Whether the new project is several places; `undefined` when the user cancelled. */
	private async severalPlaces(
		kind: InitKind,
		language: Language,
		scaffolded: boolean
	): Promise<boolean | undefined> {
		const problem = this.noPlacesBecause(kind, language, scaffolded);
		if (problem === undefined)
			return this.questions.places(this.directory, language);
		if (this.questions.choices.places === true)
			throw new UsageError(`--places ${problem}`);
		return false;
	}

	/** The tool that starts a new place of `language` in a folder with nothing of its own: no code, no `package.json` or `tsconfig.json` (a language that is present has its own) for the tool to write over, and no project file to lift. */
	private starterFor(
		kind: InitKind,
		language: Language
	): RobloxTsStarter | undefined {
		const { directory } = this;
		return kind === "place" &&
			!directory.hasHandWrittenProject &&
			!directory.has("package.json") &&
			!language.present &&
			directory.layout.codeFolders.length === 0
			? RobloxTsStarter.of(language)
			: undefined;
	}

	/** Whether the Greeter sample is written: in a new place, in a folder with no code, and for a compiled language only when its starter tool has set the folder up. */
	private wantsSample(
		kind: InitKind,
		tree: ProjectTree,
		language: Language,
		scaffolded: boolean
	): boolean {
		const { codeFolders } = this.directory.layout;
		const problem =
			kind !== "place"
				? `is for a place, not for a ${kind}.`
				: tree.kind !== "new"
					? `needs a new tree, and ${LIFTED_HERE} Move ${DEFAULT_PROJECT_FILE} away first, or leave --sample out.`
					: language.compiler && !scaffolded
						? `isn't written for ${language.copy.label} here, where ${language.copy.label} was set up already.`
						: codeFolders.length > 0
							? `is for a folder with no code, and ${codeFolders.join(", ")} has some.`
							: undefined;
		if (problem === undefined) return this.questions.sample();
		if (this.questions.choices.sample === true)
			throw new UsageError(`--sample ${problem}`);
		return false;
	}

	private static templateFiles(
		template: ProjectTemplate,
		tree: ProjectTree,
		skipGit: boolean
	): PlannedFile[] {
		const script = tree.kind === "template" ? template.script : undefined;
		return [
			...(template.kind === "place" ? [] : [template.readme]),
			...(skipGit ? [] : [template.gitignore]),
			...(script ? [script] : []),
		];
	}

	private async absent(
		files: readonly PlannedFile[]
	): Promise<PlannedFile[]> {
		const there = await Promise.all(
			files.map(({ fileName }) =>
				this.fileSystemService.exists(
					path.join(this.directory.path, fileName)
				)
			)
		);
		return files.filter(
			(file, at) => file.addition !== undefined || !there[at]
		);
	}

	private async resolveTree(
		chosen: TreeChoice,
		kind: InitKind
	): Promise<Result<ProjectTree, Diagnostic[]>> {
		if (chosen.kind === "new")
			return ok(
				kind === "place"
					? chosen
					: {
							kind: "template",
							template: kind,
							project: StarterProject.ofScript(),
						}
			);
		const reader = new ProjectReader(
			this.fileSystemService,
			this.directory.path
		);
		const project = await reader.read(chosen.from);
		if (project.isErr()) return err(project.error);
		if (kind !== "place" && project.value.takesRoutes)
			throw new UsageError(
				`--kind ${kind} starts a new ${kind}, and ${DEFAULT_PROJECT_FILE} is here, which init lifts as a place. Move ${DEFAULT_PROJECT_FILE} away first, or leave --kind out.`
			);
		return ok({
			...chosen,
			project: await reader.withInitFolders(project.value),
		});
	}

	plan(choices: ProjectChoices, builder: InitPlanBuilder): void {
		const { language, sourcePaths, compiledPath, places } = choices;
		const dirs = generatedDirs(choices);
		const derived = derivedRoutesOf(choices.tree, dirs);
		const routes = takesRoutes(choices.tree)
			? new StartingRoutes(language, derived).routes
			: undefined;
		const tree = TreePlan.of({
			tree: choices.tree,
			mounts: choices.mounts,
			dirs,
			derived,
			landings: Object.values(routes ?? {}),
		});
		const { compiler } = language;
		const name = path.basename(places?.place ?? this.directory.path);
		const config: RogenConfig = {
			...((choices.scaffold || places) && { name }),
			...tree.fields,
			...(routes && { sourcePaths: [...sourcePaths], routes }),
			...(compiledPath && { compiledPath }),
		};
		const written =
			choices.tree.kind === "lift"
				? choices.tree.project.written
				: undefined;
		builder.setConfig(
			config,
			written,
			places?.configFile ?? DEFAULT_CONFIG_FILE
		);
		const processedPath = processedPathOf(choices);
		for (const { stem, config: output } of OutputConfigs.of(config, {
			name,
			processedPath,
			releasePath: processedPath ?? compiledPath,
			releaseIgnore: this.directory.workspace.testRunner
				? `**/*.spec.${language.extension}`
				: undefined,
		}))
			builder.setConfig(
				output,
				written,
				path.posix.join(
					places?.folder ?? "",
					configFileName(`${places?.outputPrefix ?? ""}${stem}`)
				),
				false
			);
		this.summarise(builder, choices, routes);
		for (const sourcePath of places?.directories ?? sourcePaths)
			builder.addDirectory(sourcePath);
		for (const note of places?.notes ?? []) builder.addNote(note);
		if (choices.scaffold) {
			builder.setScaffold(choices.scaffold.tool);
			for (const command of choices.scaffold.after)
				builder.addCommand(command);
		}
		for (const file of choices.templateFiles ?? []) builder.addFile(file);
		if (choices.kind !== undefined && !choices.skipGit)
			builder.requestGitInit();
		if (choices.tree.kind === "lift")
			builder.setLiftedFrom(choices.tree.from);
		for (const note of tree.notes) builder.addNote(note);
		if (choices.tree.kind === "lift" && choices.processed)
			builder.addNote(
				ProjectSetup.processedNote(
					choices.tree.from,
					sourcePaths,
					choices.processed
				)
			);
		if (choices.keptCode?.length)
			builder.addNote(
				`Kept the mounts of ${joinedWithAnd(choices.keptCode)} in the tree as they are: only the project's own folder holds them all, and a source path is a folder below it. To route their code, move the folders into ${sourcePaths[0]}.`
			);
		const others = places
			? []
			: this.directory.otherProjectFiles(
					DEFAULT_PROJECT_FILE,
					...(choices.tree.kind === "lift" ? [choices.tree.from] : [])
				);
		if (others.length > 0)
			builder.addNote(
				`Left alone: ${others.join(", ")}. Rojo runs a plain project file as it is, and Rogen writes only the project files its .rogen.json files name.`
			);
		for (const warning of tree.warnings) builder.addWarning(warning);
		if (choices.tree.kind === "lift" && choices.unmounted?.length)
			builder.addWarning(
				ProjectSetup.unmountedWarning(
					choices.tree.from,
					choices.unmounted
				)
			);
		if (choices.outside?.length)
			builder.addWarning(
				ProjectSetup.outsideWarning(
					places?.configFile ?? DEFAULT_CONFIG_FILE,
					sourcePaths[0],
					choices.outside
				)
			);
		if (choices.scaffold)
			builder.addNote(
				`Starts from create-roblox-ts, which writes package.json${places ? "" : ", tsconfig.json"} and the compiler's settings.`
			);
		if (compiler && compiledPath) {
			builder.addNote(
				`Syncing from ${compiledPath}, where ${compiler.name} compiles to.`
			);
		}
		if (choices.sample) {
			const here = (...parts: string[]) =>
				builder.fromHere(path.posix.join(...parts));
			builder.addNote(
				places
					? `The Greeter sample is the feature in ${here(places.commonSourcePath)}, which every place shares, Game in ${here(places.placeSourcePath)}, and Rojo's sample Baseplate and lighting in ${here(places.folder, places.gameFolder)}. Pass --no-sample for empty source folders.`
					: `The Greeter sample is in ${here(sourcePaths[0], "Greeter")}, and Rojo's sample Baseplate and lighting in ${here(SAMPLE_GAME_FOLDER)}, which the tree mounts. Pass --no-sample for an empty ${here(sourcePaths[0])} and no ${here(SAMPLE_GAME_FOLDER)}.`
			);
		}
		this.planNextSteps(builder, choices, tree);
	}

	private summarise(
		builder: InitPlanBuilder,
		{
			kind,
			language,
			sourcePaths,
			tree,
			mounts,
			places,
			sample,
		}: ProjectChoices,
		routes: Record<string, string> | undefined
	): void {
		builder.addSummary(
			"Project",
			[
				kind === "place"
					? places
						? "several places"
						: "one place"
					: `a ${kind}`,
				language.copy.label,
				...(tree.kind === "lift" ? [`lifting ${tree.from}`] : []),
				...(sample ? ["sample Greeter"] : []),
			].join(", ")
		);
		if (routes) {
			const keys = Object.keys(routes).filter(
				(key) => key !== DeclaredKeys.FALLBACK_ROUTE
			);
			const rest = routes[DeclaredKeys.FALLBACK_ROUTE];
			builder.addSummary(
				"Code",
				`${places ? places.directories.join(", ") : sourcePaths.join(", ")} → ${keys.length > 0 ? keys.join(", ") : "no routes"}${rest ? `; other files to ${rest}` : ""}`
			);
		}
		if (mounts.length > 0)
			builder.addSummary(
				"Packages",
				mounts
					.map((mount) => `${mount.path} → ${mount.landing}`)
					.join(", ")
			);
	}

	private static processedNote(
		from: string,
		sourcePaths: readonly string[],
		{ folder, config }: { folder: string; config?: string }
	): string {
		const source = joinedWithAnd(sourcePaths);
		return config
			? `Took ${folder} as the folder Darklua writes, since ${config} is here and the mounts of ${from} into ${folder} repeat ${source}. ${DEFAULT_CONFIG_FILE} reads ${source}, and ${configFileName(PROCESSED_OUTPUT)} reads ${folder} as its "compiledPath".`
			: `Kept the mounts of ${from} into ${folder}, which repeat ${source}, since no ${Darklua.CONFIG_FILES[0]} says a processor writes ${folder}. Rojo now syncs a script there twice: from ${folder} and from its route. If a processor writes ${folder}, remove those mounts and serve a copy of ${DEFAULT_CONFIG_FILE} with "compiledPath": "${folder}".`;
	}

	private static unmountedWarning(
		from: string,
		files: readonly string[]
	): Diagnostic {
		const shown = files.slice(0, UNMOUNTED_SHOWN).join(", ");
		const more = files.length - UNMOUNTED_SHOWN;
		return warningDiagnostic(
			"init.unmountedFiles",
			{ resource: from },
			`${files.length === 1 ? "1 file" : `${files.length} files`} in the source paths ${files.length === 1 ? "is" : "are"} mounted by no node, so Rojo ignored ${files.length === 1 ? "it" : "them"}, and Rogen places ${files.length === 1 ? "it if a route matches it" : "each one a route matches"}: ${shown}${more > 0 ? ` and ${more} more` : ""}. Check where with 'rogen where <path>', and list ${files.length === 1 ? "it" : "them"} under "globIgnorePaths" to leave ${files.length === 1 ? "it" : "them"} out as Rojo did.`
		);
	}

	private static outsideWarning(
		configFile: string,
		sourcePath: string,
		found: readonly string[]
	): Diagnostic {
		const shown = joinedWithAnd(found.slice(0, UNMOUNTED_SHOWN));
		const more = found.length - UNMOUNTED_SHOWN;
		return warningDiagnostic(
			"init.codeOutsideSourcePaths",
			{ resource: configFile },
			`${more > 0 ? `${found.slice(0, UNMOUNTED_SHOWN).join(", ")} and ${more} more` : shown} ${found.length === 1 ? "holds" : "hold"} code that no source path holds and the tree doesn't mount, so Rogen places none of it. Move the code into ${sourcePath}, or list its folders under "sourcePaths" in ${configFile}.`
		);
	}

	private planNextSteps(
		builder: InitPlanBuilder,
		choices: ProjectChoices,
		tree: TreePlan
	): void {
		const {
			language,
			tree: chosen,
			places,
			projectFilesHint,
			scaffold,
		} = choices;
		const { compiler } = language;
		if (chosen.kind === "template") {
			builder.addRun(
				BUILD_COMMANDS[chosen.template](
					path.basename(this.directory.path)
				)
			);
			return;
		}
		builder.addEdit(...tree.edits);
		if (projectFilesHint) builder.addEdit(projectFilesHint);
		if (chosen.kind === "lift")
			builder.addEdit(
				`Rogen writes ${chosen.from} now, so git can stop tracking it: git rm --cached ${chosen.from}`
			);
		const configFile = places?.configFile ?? DEFAULT_CONFIG_FILE;
		if (takesRoutes(chosen))
			builder.addEdit(
				builder.configCount > 1
					? 'To change where code goes, edit "routes" in each .rogen.json. To place a folder as it is, such as Packages, mount it in the "tree" of each.'
					: `To change where code goes, edit "routes" in ${configFile}. To place a folder as it is, such as Packages, mount it in its "tree".`
			);
		const projectFile = places?.projectFile ?? DEFAULT_PROJECT_FILE;
		builder.addEdit(
			`Edit ${configFile} and leave ${projectFile} alone, since 'rogen write' overwrites it. After you add a feature folder, run 'rogen write${places ? ` ${places.place}` : ""}' so the editor's ${projectFile} follows.`
		);
		if (places?.settings)
			builder.addEdit(
				`luau-lsp reads the sourcemap of one place at a time, ${places.place} here. To switch, change the name in the generatorCommand in .vscode/settings.json.`
			);
		if (places)
			builder.addEdit(
				ProjectSetup.addPlaceStep(
					places,
					chosen.kind === "new" && chosen.game !== undefined
				)
			);
		builder.addRun(
			...(compiler
				? [(scaffold && "npm run watch") ?? compiler.compileCommand]
				: []),
			ProjectSetup.serveCommand(places, processedPathOf(choices))
		);
	}
}
