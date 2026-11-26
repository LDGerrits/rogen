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
	DEFAULT_PROJECT_FILE,
	DEFAULT_SOURCE_PATH,
	RogenConfig,
	configFileName,
} from "../config/config.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { Language, Mount, PlannedFile } from "../toolchain/toolchain.js";
import { CarriedProject, CarriedTree } from "./carried-project.js";
import { GreeterSample } from "./greeter-sample.js";
import { SampleGame } from "./sample-game.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { OutputConfigs } from "./output-configs.js";
import { InitQuestions, UnplacedCode } from "./init-questions.js";
import { InitSummary } from "./init-summary.js";
import { InitKind } from "./init-service.js";
import { NewStarter } from "./new-starter.js";
import { LISTED_SHOWN, ProjectCode } from "./project-code.js";
import { ProjectFiles } from "./project-files.js";
import { IgnoredFiles, ProjectTemplate } from "./project-template.js";
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

export type SetupProject = CarriedProject | NewStarter;

function mountsOf(directory: InitDirectory, language: Language): Mount[] {
	return [
		...language.mounts(),
		...directory.workspace.packageMounts(language),
	];
}

function ignoredFilesOf(
	directory: InitDirectory,
	language: Language
): IgnoredFiles {
	const { workspace } = directory;
	const robloxTs = RobloxTsStarter.of(language) !== undefined;
	return {
		compiled: robloxTs
			? RobloxTsStarter.ignored(language.compiler?.outDir)
			: [],
		installed: [
			...(robloxTs || workspace.nodeModules ? ["node_modules"] : []),
			...(workspace.packageManager?.installedDirs ?? []),
		].map((dir) => `/${dir}`),
	};
}

const defined = <T>(value: T | undefined): value is T => value !== undefined;

const GITKEEP = ".gitkeep";

const isServerScript = (name: string): boolean => {
	const file = new RojoFile(name, SyncRules.DEFAULT);
	return file.isLuau && file.scriptSuffix === "server";
};

const LIFTED_HERE = `${DEFAULT_PROJECT_FILE} is here, which init lifts.`;

export class ProjectSetup implements Setup<SetupProject> {
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

	async ask(): Promise<Result<SetupProject | undefined, Diagnostic[]>> {
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
		const language = await questions.language(directory);
		if (language === undefined) return ok(undefined);
		return ok(
			tree.kind === "new"
				? await this.newStarter(language)
				: await this.carried(tree, kind, language)
		);
	}

	private async carried(
		tree: CarriedTree,
		kind: InitKind,
		language: Language
	): Promise<CarriedProject> {
		const { directory, questions } = this;
		if (questions.choices.places === true)
			throw new UsageError(
				`--places ${this.noPlacesBecause(kind, language, false)}`
			);
		const compiledPath = language.compiler?.outDir;
		const lifted =
			tree.kind !== "template" && tree.project.takesRoutes
				? tree.project
				: undefined;
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
		const sourcePaths = !lifted
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
							[compiledPath].filter(defined)
						)
				: undefined;
		const processorConfig = directory.workspace.darkluaConfig;
		const unmounted =
			lifted && tree.kind === "lift"
				? await new UnmountedFiles(
						this.fileSystemService,
						directory.path
					).find(
						sourcePaths,
						liftedMounts,
						lifted.toConfig().globIgnorePaths ?? [],
						[compiledPath, processedFolder].filter(defined)
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
		const outside = lifted
			? await this.codeOutside(
					[...sourcePaths, ...liftedMounts],
					language,
					[compiledPath, processedFolder]
				)
			: [];
		const skipGit = questions.skipGit();
		const template = this.templateOf(kind, language);
		const readme = tree.kind === "lift" ? undefined : template.readme;
		const script =
			tree.kind === "template" && directory.moduleRoot === undefined
				? template.script
				: undefined;
		const files = await this.absent([
			...(readme ? [readme] : []),
			...(skipGit ? [] : [template.gitignore]),
			...(script ? [script] : []),
		]);
		const routeKeys = STANDARD_ROUTE_IDS.map((id) => language.routeKey(id));
		const finder = this.instantiationService.createInstance(CodeFinder);
		const capturedKeys =
			tree.kind === "lift"
				? [
						...(
							await finder.keySpellings(
								directory.path,
								sourcePaths,
								routeKeys,
								liftedMounts
							)
						).keys(),
					]
				: [];
		return new CarriedProject(
			kind,
			tree,
			await this.codeOf(
				language,
				sourcePaths,
				compiledPath,
				lifted ? mountsOf(directory, language) : [],
				outside
			),
			{
				files,
				emptyFolders: await this.emptyFolders(sourcePaths, files),
				skipGit,
				projectFilesHint: await this.files.projectFilesHint(),
			},
			{
				capturedKeys,
				...(processedFolder && {
					processed: {
						folder: processedFolder,
						...(processorConfig && { config: processorConfig }),
					},
				}),
				keptCode,
				unmounted,
			}
		);
	}

	private async newStarter(
		picked: Language
	): Promise<NewStarter | undefined> {
		const { directory, questions } = this;
		const starter = this.starterFor(picked);
		const language = starter ? picked.scaffolded!() : picked;
		const several = await this.severalPlaces(language, starter);
		if (several === undefined) return undefined;
		const places = several
			? await this.instantiationService
					.createInstance(StarterPlaces)
					.plan(directory.path, language, starter)
			: undefined;
		const compiledPath = places?.compiledPath ?? language.compiler?.outDir;
		const sourcePaths = places
			? [...places.sourcePaths]
			: [directory.defaultSourcePath(language)];
		const outside = await this.codeOutside(sourcePaths, language, [
			compiledPath,
		]);
		const sample = await this.wantsSample(language, starter !== undefined);
		if (sample === undefined) return undefined;
		const skipGit = questions.skipGit();
		const files = await this.absent([
			...(skipGit ? [] : [this.templateOf("place", language).gitignore]),
			...(sample ? this.sampleFiles(language, sourcePaths, places) : []),
			...(places?.files ?? []),
		]);
		return new NewStarter(
			await this.codeOf(
				language,
				sourcePaths,
				compiledPath,
				mountsOf(directory, language),
				outside
			),
			{
				files,
				emptyFolders: await this.emptyFolders(sourcePaths, files),
				skipGit,
				projectFilesHint: await this.files.projectFilesHint(),
			},
			places,
			sample ? new SampleGame() : undefined,
			starter && {
				tool: starter.scaffold(places !== undefined),
				after: places ? [starter.scripts(places.place)] : [],
			}
		);
	}

	private async codeOf(
		language: Language,
		sourcePaths: readonly string[],
		compiledPath: string | undefined,
		mounts: readonly Mount[],
		outside: readonly string[]
	): Promise<ProjectCode> {
		const keySpellings = await this.instantiationService
			.createInstance(CodeFinder)
			.keySpellings(
				this.directory.path,
				sourcePaths,
				STANDARD_ROUTE_IDS.map((id) => language.routeKey(id))
			);
		return {
			language,
			sourcePaths,
			...(compiledPath && { compiledPath }),
			mounts,
			keySpellings,
			outside,
		};
	}

	private templateOf(kind: InitKind, language: Language): ProjectTemplate {
		return new ProjectTemplate(
			kind,
			path.basename(this.directory.path),
			ignoredFilesOf(this.directory, language)
		);
	}

	private sampleFiles(
		language: Language,
		sourcePaths: readonly string[],
		places: StartingPlaces | undefined
	): PlannedFile[] {
		const sample = new GreeterSample(
			language,
			path.basename(this.directory.path)
		);
		const common = places?.commonSourcePath ?? sourcePaths[0];
		return [
			...sample.feature(common),
			...(places ? sample.place(places.placeSourcePath) : []),
			sample.readme(
				common,
				NewStarter.serveCommand(places),
				places?.place
			),
		];
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
		language: Language,
		starter: RobloxTsStarter | undefined
	): Promise<boolean | undefined> {
		const problem = this.noPlacesBecause(
			"place",
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
					.filter(defined)
					.map(normalizeDir)
			);
	}

	private starterFor(language: Language): RobloxTsStarter | undefined {
		const { directory } = this;
		return !directory.hasHandWrittenProject &&
			!directory.has("package.json") &&
			!language.present &&
			!directory.holdsCode
			? RobloxTsStarter.of(language)
			: undefined;
	}

	private async wantsSample(
		language: Language,
		scaffolded: boolean
	): Promise<boolean | undefined> {
		const writable =
			(!language.compiler || scaffolded) && !this.directory.holdsCode;
		return writable && this.questions.sample();
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

	plan(project: SetupProject, builder: InitPlanBuilder): void {
		const { code } = project;
		const { language, sourcePaths, compiledPath } = code;
		const dirs = [
			...sourcePaths,
			compiledPath,
			project.processedPath,
		].filter(defined);
		const derived = project.derivedRoutes(dirs);
		const starting = project.takesRoutes
			? new StartingRoutes(
					language,
					derived,
					code.keySpellings,
					new Set(project.capturedKeys)
				)
			: undefined;
		const routes = starting?.routes;
		const tree = TreePlan.of({
			tree: project.tree,
			mounts: code.mounts,
			dirs,
			derived,
			landings: Object.values(routes ?? {}),
		});
		const { unmounted, written, processedPath } = project;
		const { name: ownName, ...fields } = tree.fields;
		const config: RogenConfig = {
			name:
				typeof ownName === "string"
					? ownName
					: (project.name ?? path.basename(this.directory.path)),
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
		builder.setConfig(config, written, project.configFile);
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
				configFileName(`${project.outputPrefix}${stem}`),
				false
			);
		this.summarise(builder, project, routes);
		for (const sourcePath of sourcePaths)
			if (project.writes.emptyFolders.includes(sourcePath))
				builder.addFile({
					fileName: path.posix.join(sourcePath, GITKEEP),
					content: "",
				});
			else builder.addDirectory(sourcePath);
		for (const warning of tree.warnings) builder.addWarning(warning);
		if (code.outside.length > 0)
			builder.addWarning(
				ProjectSetup.outsideWarning(
					project.configFile,
					sourcePaths[0],
					code.outside
				)
			);
		const leftOut = starting?.leftOut ?? [];
		const uninstalled = this.uninstalledPackages(project);
		const others = this.directory.otherProjectFiles(
			DEFAULT_PROJECT_FILE,
			...(project.tree.kind === "lift" ? [project.tree.from] : [])
		);
		const { compiler } = language;
		const configs = builder.configNames;
		project.plan(builder, {
			notes: [
				...(leftOut.length > 0
					? [
							`Left out the ${leftOut.length === 1 ? "route" : "routes"} ${joinedWithAnd(leftOut)}, which would move folders and files of ${joinedWithAnd(sourcePaths)} named so. Rename them to route them.`,
						]
					: []),
				...tree.notes,
				...(uninstalled
					? [
							`Didn't mount ${uninstalled.sharedMount.path}, since it isn't installed. Once you run ${uninstalled.id} install, mount it at ${uninstalled.sharedMount.landing}.`,
						]
					: []),
			],
			...(others.length > 0 && {
				othersNote: `Left alone: ${others.join(", ")}. Rojo runs a plain project file as it is.`,
			}),
			...(compiler &&
				compiledPath && {
					compilerNote: `Syncing from ${compiledPath}, where ${compiler.name} compiles to.`,
				}),
			edits: tree.edits,
			configEdit:
				configs.length > 1
					? `Edit ${joinedWithAnd(configs)}, not their project files, which 'rogen write' replaces.`
					: `Edit ${configs[0]}, not ${project.projectFile}, which 'rogen write' replaces.`,
			folderName: path.basename(this.directory.path),
			tracksProjectFile: this.directory.tracksProjectFile,
		});
	}

	private uninstalledPackages(project: SetupProject) {
		const { packageManager, packageDirs } = this.directory.workspace;
		if (
			!packageManager ||
			packageDirs.has(packageManager.shared) ||
			!project.takesRoutes ||
			project.mountedFolders.includes(packageManager.shared)
		)
			return undefined;
		return packageManager;
	}

	private summarise(
		builder: InitPlanBuilder,
		project: SetupProject,
		routes: Record<string, string> | undefined
	): void {
		const { sourcePaths, mounts } = project.code;
		project.summarise(builder, this.questions.shown);
		if (routes)
			builder.addSummary("Code", InitSummary.code(sourcePaths, routes));
		if (mounts.length > 0)
			builder.addSummary(
				"Packages",
				mounts
					.map((mount) => `${mount.path} → ${mount.landing}`)
					.join(", ")
			);
	}

	private static outsideWarning(
		configFile: string,
		sourcePath: string,
		found: readonly string[]
	): Diagnostic {
		return warningDiagnostic(
			"init.codeOutsideSourcePaths",
			{ resource: configFile },
			`${joinedBriefly(found, LISTED_SHOWN)} ${found.length === 1 ? "holds" : "hold"} code outside the source paths and mounts, so it is not placed. Move it into ${sourcePath}, or add its folder to "sourcePaths".`
		);
	}
}
