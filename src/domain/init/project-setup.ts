import path from "path";
import { UsageError } from "../../base/errors.js";
import { containsPosix, normalizeDir } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { joinedBriefly, joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT_FILE,
	DEFAULT_SOURCE_PATH,
	RogenConfig,
	configFileName,
} from "../config/config.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import {
	Darklua,
	Language,
	Mount,
	PlannedFile,
} from "../toolchain/toolchain.js";
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
import { InitQuestions, UnplacedCode } from "./init-questions.js";
import { InitSummary } from "./init-summary.js";
import { InitKind, PlannedCommand, PlannedScaffold } from "./init-service.js";
import { ProjectFiles } from "./project-files.js";
import { ProjectTemplate } from "./project-template.js";
import { StarterProject } from "./starter-project.js";
import { ProjectReader } from "./project-reader.js";
import { Setup } from "./setup.js";
import { RobloxTsStarter } from "./roblox-ts-starter.js";
import { STANDARD_ROUTE_IDS, StartingRoutes } from "./starting-routes.js";
import { StarterPlaces, StartingPlaces } from "./starter-places.js";
import { ProcessedFolder } from "./processed-folder.js";
import { MountedCode } from "./mounted-code.js";
import { CodeFinder } from "./code-finder.js";
import { UnmountedFiles } from "./unmounted-files.js";
import { ProjectTree, TreeChoice, TreePlan } from "./tree-plan.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

type ReadChoice =
	| { readonly kind: "new" }
	| {
			readonly kind: "lift";
			readonly from: string;
			readonly project: StarterProject;
	  };

export interface ProcessedOutput {
	readonly folder: string;
	readonly config?: string;
}

export interface ProjectChoices {
	readonly language: Language;
	readonly sourcePaths: readonly string[];
	readonly keySpellings?: Readonly<Record<string, string>>;
	readonly capturedKeys?: readonly string[];
	readonly compiledPath?: string;
	readonly processed?: ProcessedOutput;
	readonly tree: ProjectTree;
	readonly mounts: readonly Mount[];
	readonly keptCode?: readonly string[];
	readonly outside?: readonly string[];
	readonly unmounted: readonly string[];
	readonly kind?: InitKind;
	readonly skipGit?: boolean;
	readonly templateFiles: readonly PlannedFile[];
	readonly emptyFolders?: readonly string[];
	readonly sample?: boolean;
	readonly places?: StartingPlaces;
	readonly scaffold?: {
		readonly tool: PlannedScaffold;
		readonly after: readonly PlannedCommand[];
	};
	readonly projectFilesHint?: string;
}

function carriedProject(tree: ProjectTree): StarterProject | undefined {
	return tree.kind === "lift" || tree.kind === "rojoTemplate"
		? tree.project
		: undefined;
}

function derivedRoutesOf(
	tree: ProjectTree,
	dirs: readonly string[]
): DerivedRoutes | undefined {
	const carried = carriedProject(tree);
	return carried ? DerivedRoutes.of(carried, dirs) : undefined;
}

function mountsOf(directory: InitDirectory, language: Language): Mount[] {
	return [
		...language.mounts(),
		...directory.workspace.packageMounts(language),
	];
}

function takesRoutes(tree: ProjectTree): boolean {
	return tree.kind === "new" || carriedProject(tree)?.takesRoutes === true;
}

const BUILD_COMMANDS: Readonly<
	Record<Exclude<InitKind, "place">, (name: string) => string>
> = {
	model: (name) => `rogen build -o "${name}.rbxmx"`,
	plugin: (name) => `rogen build -p "${name}.rbxm"`,
};

function processedPathOf({
	processed,
}: Pick<ProjectChoices, "processed">): string | undefined {
	return processed?.config ? processed.folder : undefined;
}

function generatedDirs(
	choices: Pick<ProjectChoices, "sourcePaths" | "compiledPath" | "processed">
): string[] {
	return [
		...choices.sourcePaths,
		choices.compiledPath,
		processedPathOf(choices),
	].filter((dir) => dir !== undefined);
}

const LISTED_SHOWN = 5;

const GITKEEP = ".gitkeep";

const isServerScript = (name: string): boolean => {
	const file = new RojoFile(name, SyncRules.DEFAULT);
	return file.isLuau && file.scriptSuffix === "server";
};

const LIFTED_HERE = `${DEFAULT_PROJECT_FILE} is here, which init lifts.`;

export class ProjectSetup implements Setup<ProjectChoices> {
	private readonly files: ProjectFiles;
	private readonly reader: ProjectReader;

	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		this.files = instantiationService.createInstance(
			ProjectFiles,
			directory.path
		);
		this.reader = instantiationService.createInstance(
			ProjectReader,
			directory.path
		);
	}

	async ask(): Promise<Result<ProjectChoices | undefined, Diagnostic[]>> {
		const { directory, questions } = this;
		const chosen = await this.read(questions.tree(directory));
		if (chosen.isErr()) return chosen;
		const kind = questions.kind(
			directory,
			chosen.value.kind === "lift"
				? await this.kindOf(chosen.value.project)
				: undefined
		);
		const tree = await this.resolveTree(chosen.value, kind);
		const picked = await questions.language(directory);
		if (picked === undefined) return ok(undefined);
		const starter = this.starterFor(kind, picked);
		const language = starter ? picked.scaffolded!() : picked;

		const several = await this.severalPlaces(kind, language, starter);
		if (several === undefined) return ok(undefined);
		const places = several
			? await this.instantiationService
					.createInstance(StarterPlaces)
					.plan(directory.path, language, starter)
			: undefined;

		const compiledPath = places?.compiledPath ?? language.compiler?.outDir;
		const routed = takesRoutes(tree);
		const lifted = routed ? carriedProject(tree) : undefined;
		const liftedMounts = lifted?.mountedFolders() ?? [];
		const code =
			lifted && !language.compiler
				? await this.instantiationService
						.createInstance(MountedCode, directory.path)
						.find(
							lifted,
							[...directory.workspace.packageDirs],
							directory.layout.codeFolders
						)
				: undefined;
		const sourcePaths = places
			? [...places.sourcePaths]
			: !routed
				? []
				: code && (code.sourcePaths.length > 0 || code.keptOnly)
					? [...code.sourcePaths]
					: [directory.defaultSourcePath(language)];

		const processedFolder = code
			? code.processed
			: lifted
				? await this.instantiationService
						.createInstance(ProcessedFolder, directory.path)
						.find(
							sourcePaths,
							liftedMounts,
							[compiledPath].filter(
								(folder) => folder !== undefined
							)
						)
				: undefined;
		const processorConfig = directory.workspace.darkluaConfig;
		const processed = processedFolder
			? {
					folder: processedFolder,
					...(processorConfig && { config: processorConfig }),
				}
			: undefined;
		const mounts = routed ? mountsOf(directory, language) : [];

		const unmounted =
			lifted && tree.kind === "lift"
				? await new UnmountedFiles(
						this.fileSystemService,
						directory.path
					).find(
						sourcePaths,
						liftedMounts,
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
			? await this.codeOutside(
					[...sourcePaths, ...liftedMounts],
					language,
					[compiledPath, processedFolder]
				)
			: [];

		const sample = await this.wantsSample(
			kind,
			tree,
			language,
			starter !== undefined
		);
		if (sample === undefined) return ok(undefined);
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
					...game.written(""),
					sampleOf.readme(
						places?.commonSourcePath ?? sourcePaths[0],
						ProjectSetup.serveCommand(places),
						places?.place
					),
				]
			: [];

		const skipGit = questions.skipGit();
		const templateFiles = await this.absent([
			...ProjectSetup.templateFiles(
				new ProjectTemplate(
					kind,
					path.basename(directory.path),
					RobloxTsStarter.of(language)
						? RobloxTsStarter.ignored(language.compiler?.outDir)
						: []
				),
				tree,
				skipGit,
				directory.moduleRoot !== undefined
			),
			...sampleFiles,
			...(places?.files ?? []),
		]);
		const finder = this.instantiationService.createInstance(CodeFinder);
		const routeKeys = STANDARD_ROUTE_IDS.map((id) => language.routeKey(id));
		const keySpellings = await finder.keySpellings(
			this.directory.path,
			places?.directories ?? sourcePaths,
			routeKeys
		);
		const capturedKeys =
			tree.kind === "lift"
				? [
						...(
							await finder.keySpellings(
								this.directory.path,
								sourcePaths,
								routeKeys,
								liftedMounts
							)
						).keys(),
					]
				: [];
		return ok({
			language,
			sourcePaths: [...sourcePaths],
			...(keySpellings.size > 0 && {
				keySpellings: Object.fromEntries(keySpellings),
			}),
			...(capturedKeys.length > 0 && { capturedKeys }),
			...(compiledPath && { compiledPath }),
			...(processed && { processed }),
			tree: game && tree.kind === "new" ? { ...tree, game } : tree,
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
					after: places ? [starter.scripts(places.place)] : [],
				},
			}),
			projectFilesHint: await this.files.projectFilesHint(),
			templateFiles,
			emptyFolders: await this.emptyFolders(
				places?.directories ?? sourcePaths,
				templateFiles
			),
		});
	}

	private async emptyFolders(
		folders: readonly string[],
		files: readonly PlannedFile[]
	): Promise<string[]> {
		const there = await Promise.all(
			folders.map((folder) =>
				this.fileSystemService.exists(
					path.join(this.directory.path, folder)
				)
			)
		);
		return folders.filter(
			(folder, at) =>
				!there[at] &&
				!files.some(({ fileName }) => containsPosix(folder, fileName))
		);
	}

	private static serveCommand(
		places: StartingPlaces | undefined,
		processedPath?: string
	): string {
		if (places) return `rogen serve ${places.place}`;
		return processedPath
			? `rogen serve ${PROCESSED_OUTPUT}`
			: "rogen serve";
	}

	private static addPlaceStep(
		places: StartingPlaces,
		game: boolean,
		starter: RobloxTsStarter | undefined
	): string {
		const port = "from a second terminal with its own --port";
		const { outputPrefix, gameFolder } = places;
		const lobby = (file: string) => file.replace(outputPrefix, "lobby.");
		const release = configFileName(`${outputPrefix}${RELEASE_OUTPUT}`);
		const lobbyGame = path.posix.join(
			path.posix.dirname(gameFolder),
			"lobby"
		);
		const edited =
			'Give the copy its own "name" and source path: Rogen errors while it is still the same config, or has the same name and no source path in common.';
		const copied = `copy ${places.configFile} to ${lobby(places.configFile)}`;
		const copy = game
			? `${copied}, point each ${gameFolder} in its tree to ${lobbyGame}, make src/lobby and copy ${gameFolder} to ${lobbyGame}. ${edited}`
			: `${copied} and make src/lobby. ${edited}`;
		const compile = starter
			? ` ${starter.addPlaceStep(places.place, "lobby", lobby(places.configFile))}`
			: "";
		return `Add another place: ${copy} Do the same for ${release} if there is one.${compile} Serve it ${port}: 'rogen serve lobby --port <port>'.`;
	}

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
		if (this.directory.layout.templateFolders.length > 0)
			return `starts a new tree, and ${DEFAULT_SOURCE_PATH} is laid out as Rojo's place template, which init keeps. Leave --places out.`;
		return undefined;
	}

	private async severalPlaces(
		kind: InitKind,
		language: Language,
		starter: RobloxTsStarter | undefined
	): Promise<boolean | undefined> {
		const problem = this.noPlacesBecause(
			kind,
			language,
			starter !== undefined
		);
		if (problem === undefined)
			return this.questions.places(
				this.directory,
				language,
				this.questions.showsPlaces(this.directory)
					? await this.unplacedBy(language, starter)
					: {}
			);
		if (this.questions.choices.places === true)
			throw new UsageError(`--places ${problem}`);
		return false;
	}

	private async unplacedBy(
		language: Language,
		starter: RobloxTsStarter | undefined
	): Promise<UnplacedCode> {
		if (starter) return {};
		const places = await this.instantiationService
			.createInstance(StarterPlaces)
			.plan(this.directory.path, language, starter);
		const [one, several] = await Promise.all(
			[
				[this.directory.defaultSourcePath(language)],
				places.sourcePaths,
			].map((held) => this.codeOutside(held, language))
		);
		return {
			...(one.length > 0 && { one: joinedBriefly(one, LISTED_SHOWN) }),
			...(several.length > 0 && {
				several: joinedBriefly(several, LISTED_SHOWN),
			}),
		};
	}

	private codeOutside(
		held: readonly string[],
		language: Language,
		skipped: readonly (string | undefined)[] = []
	): Promise<string[]> {
		return this.instantiationService
			.createInstance(CodeFinder)
			.codeOutside(
				this.directory.path,
				held.map(normalizeDir),
				[
					...this.directory.workspace.packageDirs,
					...language.reservedFolders,
					...skipped,
				]
					.filter((folder) => folder !== undefined)
					.map(normalizeDir)
			);
	}

	private starterFor(
		kind: InitKind,
		language: Language
	): RobloxTsStarter | undefined {
		const { directory } = this;
		return kind === "place" &&
			!directory.hasHandWrittenProject &&
			!directory.has("package.json") &&
			!language.present &&
			!directory.holdsCode
			? RobloxTsStarter.of(language)
			: undefined;
	}

	private async wantsSample(
		kind: InitKind,
		tree: ProjectTree,
		language: Language,
		scaffolded: boolean
	): Promise<boolean | undefined> {
		const writable =
			kind === "place" &&
			tree.kind === "new" &&
			(!language.compiler || scaffolded) &&
			!this.directory.holdsCode;
		return writable && this.questions.sample();
	}

	private static templateFiles(
		template: ProjectTemplate,
		tree: ProjectTree,
		skipGit: boolean,
		hasModule: boolean
	): PlannedFile[] {
		const readme = tree.kind === "lift" ? undefined : template.readme;
		const script =
			tree.kind === "template" && !hasModule
				? template.script
				: undefined;
		return [
			...(readme ? [readme] : []),
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

	private async kindOf(project: StarterProject): Promise<InitKind> {
		if (project.takesRoutes) return "place";
		const root = project.rootPath;
		if (root === undefined) return "model";
		if (isServerScript(path.posix.basename(root))) return "plugin";
		const scripts = await Promise.all(
			[...RojoFile.INIT_FILES]
				.filter(isServerScript)
				.map((name) =>
					this.fileSystemService.exists(
						path.join(this.directory.path, root, name)
					)
				)
		);
		return scripts.some(Boolean) ? "plugin" : "model";
	}

	private async read(
		chosen: TreeChoice
	): Promise<Result<ReadChoice, Diagnostic[]>> {
		if (chosen.kind === "new") return ok(chosen);
		const project = await this.reader.read(chosen.from);
		return project.isErr()
			? err(project.error)
			: ok({ ...chosen, project: project.value });
	}

	private async resolveTree(
		chosen: ReadChoice,
		kind: InitKind
	): Promise<ProjectTree> {
		const { reader } = this;
		const { templateFolders } = this.directory.layout;
		if (chosen.kind === "new" && kind === "place" && templateFolders.length)
			return {
				kind: "rojoTemplate",
				project: await reader.withInitFolders(
					StarterProject.ofRojoTemplate(templateFolders)
				),
			};
		if (chosen.kind === "new")
			return kind === "place"
				? chosen
				: {
						kind: "template",
						template: kind,
						project: StarterProject.ofScript(
							this.directory.moduleRoot
						),
					};
		if (kind !== "place" && chosen.project.takesRoutes)
			throw new UsageError(
				`--kind ${kind} starts a new ${kind}, and ${DEFAULT_PROJECT_FILE} is here, which init lifts as a place. Move ${DEFAULT_PROJECT_FILE} away first, or leave --kind out.`
			);
		return {
			...chosen,
			project: await reader.withInitFolders(chosen.project),
		};
	}

	plan(choices: ProjectChoices, builder: InitPlanBuilder): void {
		const { language, sourcePaths, compiledPath, places } = choices;
		const dirs = generatedDirs(choices);
		const derived = derivedRoutesOf(choices.tree, dirs);
		const spellings = new Map(Object.entries(choices.keySpellings ?? {}));
		const starting = takesRoutes(choices.tree)
			? new StartingRoutes(
					language,
					derived,
					spellings,
					new Set(choices.capturedKeys)
				)
			: undefined;
		const routes = starting?.routes;
		const tree = TreePlan.of({
			tree: choices.tree,
			mounts: choices.mounts,
			dirs,
			derived,
			landings: Object.values(routes ?? {}),
		});
		const { compiler } = language;
		const name = path.basename(places?.place ?? this.directory.path);
		const { unmounted } = choices;
		const { name: ownName, ...fields } = tree.fields;
		const config: RogenConfig = {
			name: typeof ownName === "string" ? ownName : name,
			...fields,
			...(unmounted.length > 0 && {
				globIgnorePaths: [
					...(tree.fields.globIgnorePaths ?? []),
					...unmounted,
				],
			}),
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
			processedPath,
			releasePath: processedPath ?? compiledPath,
			releaseIgnore: this.directory.workspace.testRunner
				? `**/*.spec.${language.extension}`
				: undefined,
		}))
			builder.setConfig(
				output,
				written,
				configFileName(`${places?.outputPrefix ?? ""}${stem}`),
				false
			);
		this.summarise(builder, choices, routes);
		for (const sourcePath of places?.directories ?? sourcePaths)
			if (choices.emptyFolders?.includes(sourcePath))
				builder.addFile({
					fileName: path.posix.join(sourcePath, GITKEEP),
					content: "",
				});
			else builder.addDirectory(sourcePath);
		for (const note of places?.notes ?? []) builder.addNote(note);
		if (choices.scaffold) {
			builder.setScaffold(choices.scaffold.tool);
			for (const command of choices.scaffold.after)
				builder.addCommand(command);
		}
		for (const file of choices.templateFiles) builder.addFile(file);
		if (choices.kind !== undefined && !choices.skipGit)
			builder.requestGitInit();
		if (choices.tree.kind === "lift") {
			builder.setLiftedFrom(choices.tree.from);
			builder.setAction("lift");
		}
		const leftOut = starting?.leftOut ?? [];
		if (leftOut.length > 0)
			builder.addNote(
				`Left out the ${leftOut.length === 1 ? "route" : "routes"} ${joinedWithAnd(leftOut)}, since ${joinedWithAnd(sourcePaths)} holds folders or names spelled so, which Rojo places with the rest of their mount and a route would move. To route code that way, rename them and add the key to "routes".`
			);
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
				sourcePaths.length === 0
					? `Kept the mounts of ${joinedWithAnd(choices.keptCode)} in the tree as they are: a folder with an init file is one instance, so Rogen routes no code in it.`
					: `Kept the mounts of ${joinedWithAnd(choices.keptCode)} in the tree as they are: only the project's own folder holds them all, and a source path is a folder below it. To route their code, move the folders into ${sourcePaths[0]}.`
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
		if (choices.tree.kind === "lift" && unmounted.length > 0) {
			const them = unmounted.length === 1 ? "it" : "them";
			builder.addNote(
				`Left out ${joinedBriefly(unmounted, LISTED_SHOWN)} with "globIgnorePaths", since no node of ${choices.tree.from} mounts ${them}, so Rojo ignored ${them}. To have Rogen route ${them}, take ${them} out of "globIgnorePaths".`
			);
		}
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
			const flag = this.questions.interactive
				? ""
				: places
					? " Pass --no-sample for empty source folders."
					: ` Pass --no-sample for an empty ${here(sourcePaths[0])}/ and no ${here(SAMPLE_GAME_FOLDER)}/.`;
			builder.addNote(
				places
					? `The Greeter sample is the feature in ${here(places.commonSourcePath)}, which every place shares, Game in ${here(places.placeSourcePath)}, and Rojo's sample Baseplate and lighting in ${here(places.gameFolder)}.${flag}`
					: `The Greeter sample is in ${here(sourcePaths[0], "Greeter")}, and Rojo's sample Baseplate and lighting in ${here(SAMPLE_GAME_FOLDER)}/, which the tree mounts.${flag}`
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
		const { shown } = this.questions;
		const project = [
			...(kind !== "place"
				? [`a ${kind}`]
				: shown.has("places")
					? []
					: [places ? "several places" : "one place"]),
			...(shown.has("language") ? [] : [language.copy.label]),
			...(tree.kind === "lift" ? [`lifting ${tree.from}`] : []),
		];
		if (project.length > 0)
			builder.addSummary("Project", project.join(", "));
		if (sample && !shown.has("sample"))
			builder.addSummary("Sample", "Greeter");
		if (routes)
			builder.addSummary(
				"Code",
				InitSummary.code(places?.directories ?? sourcePaths, routes)
			);
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
		{ folder, config }: ProcessedOutput
	): string {
		const source = joinedWithAnd(sourcePaths);
		return config
			? `Took ${folder} as the folder Darklua writes, since ${config} is here and the mounts of ${from} into ${folder} repeat ${source}. ${DEFAULT_CONFIG_FILE} reads ${source}, and ${configFileName(PROCESSED_OUTPUT)} reads ${folder} as its "compiledPath".`
			: `Kept the mounts of ${from} into ${folder}, which repeat ${source}, since no ${Darklua.CONFIG_FILES[0]} says a processor writes ${folder}. Rojo now syncs a script there twice: from ${folder} and from its route. If a processor writes ${folder}, remove those mounts and serve a copy of ${DEFAULT_CONFIG_FILE} with "compiledPath": "${folder}".`;
	}

	private static outsideWarning(
		configFile: string,
		sourcePath: string,
		found: readonly string[]
	): Diagnostic {
		return warningDiagnostic(
			"init.codeOutsideSourcePaths",
			{ resource: configFile },
			`${joinedBriefly(found, LISTED_SHOWN)} ${found.length === 1 ? "holds" : "hold"} code outside every source path and mount, so Rogen places none of it. Move it into ${sourcePath}, or add its folder to "sourcePaths".`
		);
	}

	private planNextSteps(
		builder: InitPlanBuilder,
		choices: ProjectChoices,
		tree: TreePlan
	): void {
		const { language, tree: chosen, places, projectFilesHint } = choices;
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
		if (chosen.kind === "lift" && this.directory.tracksProjectFile)
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
			`Edit ${configFile} and leave ${projectFile} alone, since 'rogen write' replaces it.${takesRoutes(chosen) ? ` After you add a feature folder, run 'rogen write${places ? ` ${places.place}` : ""}' so the editor's ${projectFile} follows.` : ""}`
		);
		if (places?.settings)
			builder.addEdit(
				`luau-lsp reads the sourcemap of one place at a time, ${places.place} here. To switch, change the name in the generatorCommand in .vscode/settings.json.`
			);
		if (places)
			builder.addEdit(
				ProjectSetup.addPlaceStep(
					places,
					chosen.kind === "new" && chosen.game !== undefined,
					RobloxTsStarter.of(language)
				)
			);
		if (chosen.kind === "lift" && !takesRoutes(chosen)) {
			builder.addRun(
				BUILD_COMMANDS[choices.kind === "plugin" ? "plugin" : "model"](
					chosen.project.name ?? path.basename(this.directory.path)
				)
			);
			return;
		}
		builder.addRun(
			...(compiler ? [compiler.compileCommand] : []),
			ProjectSetup.serveCommand(places, processedPathOf(choices))
		);
	}
}
