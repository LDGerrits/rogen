import path from "path";
import { UsageError } from "../../base/errors.js";
import { normalizeDir } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT_FILE,
	ProjectChanges,
	RogenConfig,
} from "../config/config.js";
import {
	Darklua,
	Language,
	Mount,
	PlannedFile,
} from "../toolchain/toolchain.js";
import { DerivedRoutes } from "./derived-routes.js";
import { GreeterSample, SAMPLE_ROUTES } from "./greeter-sample.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { InitKind, PlannedCommand, PlannedScaffold } from "./init-service.js";
import { ProjectTemplate } from "./project-template.js";
import { StarterProject } from "./starter-project.js";
import { ProjectReader } from "./project-reader.js";
import { Setup } from "./setup.js";
import { RobloxTsStarter } from "./roblox-ts-starter.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import { StarterPlaces, StartingPlaces } from "./starter-places.js";
import { SyncSteps } from "./sync-steps.js";
import { UnmountedFiles } from "./unmounted-files.js";
import { ProjectTree, TreeChoice, TreePlan } from "./tree-plan.js";

export interface ProjectChoices {
	readonly language: Language;
	readonly darklua: Darklua | undefined;
	readonly sourcePaths: readonly string[];
	readonly syncPath?: string;
	readonly tree: ProjectTree;
	readonly mounts: readonly Mount[];
	readonly routes: readonly RouteId[];
	readonly fallback: boolean;
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
	/** Whether luau-lsp is set up in the folder, which keeps `sourcemap.json` current for Darklua. */
	readonly luauLsp?: boolean;
	/** What to add to the `.gitignore` that was there, which `init` never edits. */
	readonly gitignoreHint?: string;
}

function derivedRoutesOf(
	tree: ProjectTree,
	dirs: readonly string[]
): DerivedRoutes | undefined {
	return tree.kind === "lift"
		? DerivedRoutes.of(tree.from, tree.project, dirs)
		: undefined;
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
	language,
	darklua,
	sourcePaths,
	syncPath,
}: Pick<
	ProjectChoices,
	"language" | "darklua" | "sourcePaths" | "syncPath"
>): string[] {
	const { compiler } = language;
	return [
		...sourcePaths,
		...(syncPath ? [syncPath] : []),
		...(darklua && compiler ? [compiler.outDir] : []),
	];
}

const UNMOUNTED_SHOWN = 5;

const PROCESSED_PROJECT = "dist";

const RELEASE_PROJECT = "release";

function projectsOf({
	language,
	darklua,
	syncPath,
	testRunner,
	inherited,
}: Pick<ProjectChoices, "language" | "darklua" | "syncPath"> & {
	readonly testRunner: string | undefined;
	readonly inherited: readonly string[];
}): Pick<RogenConfig, "projects" | "serveProject"> {
	const processed = darklua && syncPath ? { syncPath } : undefined;
	const projects: Record<string, ProjectChanges> = {
		...(processed && { [PROCESSED_PROJECT]: processed }),
		...(testRunner && {
			[RELEASE_PROJECT]: {
				...processed,
				globIgnorePaths: [
					...inherited,
					`**/*.spec.${language.extension}`,
				],
			},
		}),
	};
	return {
		...(processed && { serveProject: PROCESSED_PROJECT }),
		...(Object.keys(projects).length > 0 && { projects }),
	};
}

export class ProjectSetup implements Setup<ProjectChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		private readonly fileSystemService: FileReader
	) {}

	async ask(): Promise<Result<ProjectChoices | undefined, Diagnostic[]>> {
		const { directory, questions } = this;
		const kind = questions.kind();
		const picked = await questions.language(directory);
		if (picked === undefined) return ok(undefined);
		const starter = this.starterFor(kind, picked);
		const language = starter ? (picked.scaffolded?.() ?? picked) : picked;
		const usesDarklua = await questions.darklua(directory);
		if (usesDarklua === undefined) return ok(undefined);
		const darklua = usesDarklua ? directory.workspace.darklua : undefined;
		questions.usesDarklua = usesDarklua;

		const several = await this.severalPlaces(
			kind,
			language,
			darklua,
			starter !== undefined
		);
		if (several === undefined) return ok(undefined);
		const places = several
			? await new StarterPlaces(this.fileSystemService).plan(
					directory.path,
					starter && ((place, shared) => starter.place(place, shared))
				)
			: undefined;
		if (places && questions.choices.sourcePaths !== undefined)
			throw new UsageError(
				`--source-path would change nothing, since several places share ${places.sharedSourcePath}.`
			);

		const sourcePaths = places
			? [places.sharedSourcePath]
			: (await this.startsUnrouted(kind))
				? []
				: await questions.sourcePaths(directory, language);
		if (sourcePaths === undefined) return ok(undefined);

		const chosen = await questions.tree(directory);
		if (chosen === undefined) return ok(undefined);
		const tree = await this.resolveTree(chosen, kind);
		if (tree.isErr()) return tree;

		let syncPath = places
			? undefined
			: new SyncSteps(language, darklua).syncPath;
		if (darklua) {
			const answer = await questions.syncPath(directory, [
				...sourcePaths,
				...(language.compiler ? [language.compiler.outDir] : []),
			]);
			if (answer === undefined) return ok(undefined);
			syncPath = answer;
		}

		const routed = takesRoutes(tree.value);
		const mounted = routed
			? await questions.mounts(directory, language)
			: [];
		if (mounted === undefined) return ok(undefined);
		// Each place compiles into its own include, so the root's is never there.
		const mounts =
			starter && places
				? mounted.map((mount) => ({ ...mount, optional: true }))
				: mounted;

		const routes = routed
			? await questions.routes(
					language,
					derivedRoutesOf(
						tree.value,
						generatedDirs({
							language,
							darklua,
							sourcePaths,
							syncPath,
						})
					)
				)
			: { routes: [], fallback: false };
		if (routes === undefined) return ok(undefined);

		const unmounted =
			routed && tree.value.kind === "lift"
				? await new UnmountedFiles(
						this.fileSystemService,
						directory.path
					).find(
						sourcePaths,
						tree.value.project.mountedFolders(),
						tree.value.project.toConfig().globIgnorePaths ?? []
					)
				: [];

		const sample = this.wantsSample(
			kind,
			tree.value,
			language,
			routes.routes,
			starter !== undefined
		);
		const sampleOf = new GreeterSample(
			language,
			path.basename(directory.path)
		);
		const sampleFiles = sample
			? [
					...sampleOf.feature(sourcePaths[0]),
					...(places ? [sampleOf.place(places.placeSourcePath)] : []),
					sampleOf.readme(sourcePaths[0], places?.place),
				]
			: [];

		const skipGit = questions.skipGit();
		const processed = darklua && syncPath ? syncPath : undefined;
		const darkluaConfig =
			darklua && directory.workspace.darkluaConfig === undefined
				? [
						{
							fileName: darklua.configFiles[0],
							content: darklua.configFor(language),
						},
					]
				: [];
		return ok({
			language,
			darklua,
			sourcePaths: [...sourcePaths],
			...(syncPath && { syncPath }),
			tree:
				sample && tree.value.kind === "new"
					? { ...tree.value, game: true }
					: tree.value,
			mounts,
			routes: routes.routes,
			fallback: routes.fallback,
			unmounted,
			kind,
			skipGit,
			sample,
			...(places && { places }),
			...(starter && {
				scaffold: {
					tool: starter.scaffold(),
					after: places ? [starter.scripts(places.place)] : [],
				},
			}),
			luauLsp: await this.luauLspIsSetUp(),
			...(processed &&
				!skipGit && {
					gitignoreHint: await this.gitignoreHint(processed),
				}),
			templateFiles: await this.absent([
				...ProjectSetup.templateFiles(
					new ProjectTemplate(
						kind,
						path.basename(directory.path),
						processed,
						starter
							? RobloxTsStarter.ignored(places !== undefined)
							: []
					),
					tree.value,
					skipGit
				),
				...darkluaConfig,
				...sampleFiles,
				...(places?.files ?? []),
				...(starter && places
					? [starter.rootTsconfig(places.sharedSourcePath)]
					: []),
			]),
		});
	}

	/** Whether the editor settings here name luau-lsp. */
	private async luauLspIsSetUp(): Promise<boolean> {
		for (const file of [
			".vscode/settings.json",
			".vscode/extensions.json",
		]) {
			const text = await tryWithAsync(() =>
				this.fileSystemService.readFile(
					path.join(this.directory.path, file)
				)
			);
			if (
				text.isOk() &&
				/luau-lsp/i.test(text.value) &&
				!/luau-lsp\.sourcemap\.(enabled|autogenerate)"\s*:\s*false/.test(
					text.value
				)
			)
				return true;
		}
		return false;
	}

	/** What to tell the user to add to the `.gitignore` here when it doesn't list the sync path; none when there is no `.gitignore` (init writes one that does) or it lists it. */
	private async gitignoreHint(syncPath: string): Promise<string | undefined> {
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(
				path.join(this.directory.path, ".gitignore")
			)
		);
		if (text.isErr()) return undefined;
		const folder = normalizeDir(syncPath).replace(/\/$/, "");
		const listed = text.value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"))
			.map((line) =>
				line
					.replace(/^\*\*\//, "")
					.replace(/^\//, "")
					.replace(/\/(\*\*?)?$/, "")
			)
			.includes(folder);
		return listed
			? undefined
			: `Add /${folder} to .gitignore so the processed code isn't committed.`;
	}

	/** Why a new project can't be several places, which `--places` would be an error for. */
	private noPlacesBecause(
		kind: InitKind,
		language: Language,
		darklua: Darklua | undefined,
		scaffolded: boolean
	): string | undefined {
		const given = this.questions.choices.projectFile;
		if (kind !== "place") return `is for a place, not for a ${kind}.`;
		const later =
			"Start with one place, then add more with 'rogen init places/<name>'.";
		if (language.compiler && !scaffolded)
			return `isn't set up for ${language.copy.label} yet. ${later}`;
		if (darklua) return `isn't set up with Darklua yet. ${later}`;
		if (this.directory.hasHandWrittenProject && given !== "new")
			return `starts a new tree, and ${DEFAULT_PROJECT_FILE} is here. Pass --project-file new, or leave --places out to lift it.`;
		return undefined;
	}

	/** Whether the new project is several places; `undefined` when the user cancelled. */
	private async severalPlaces(
		kind: InitKind,
		language: Language,
		darklua: Darklua | undefined,
		scaffolded: boolean
	): Promise<boolean | undefined> {
		const problem = this.noPlacesBecause(
			kind,
			language,
			darklua,
			scaffolded
		);
		if (problem === undefined) return this.questions.places(this.directory);
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

	/** Whether the Greeter sample is written: in a new place, in a folder with no code, with the routes its folders are named after, and for a compiled language only when its starter tool has set the folder up. */
	private wantsSample(
		kind: InitKind,
		tree: ProjectTree,
		language: Language,
		routes: readonly RouteId[],
		scaffolded: boolean
	): boolean {
		const { codeFolders } = this.directory.layout;
		const problem =
			kind !== "place"
				? `is for a place, not for a ${kind}.`
				: tree.kind !== "new"
					? `needs a new tree, and ${DEFAULT_PROJECT_FILE} is lifted.`
					: language.compiler && !scaffolded
						? `isn't written for ${language.copy.label} here, where ${language.copy.label} was set up already.`
						: codeFolders.length > 0
							? `is for a folder with no code, and ${codeFolders.join(", ")} has some.`
							: SAMPLE_ROUTES.some(
										(route) => !routes.includes(route)
								  )
								? `needs the ${SAMPLE_ROUTES.join(", ")} routes.`
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

	/** Whether the tree is settled before any question and takes no routes, so a source path would change nothing. */
	private async startsUnrouted(kind: InitKind): Promise<boolean> {
		const { directory, questions } = this;
		const given = questions.choices.projectFile;
		if (!directory.hasHandWrittenProject || given === "new")
			return kind !== "place";
		if (given !== "lift" && questions.interactive) return false;
		const project = await new ProjectReader(
			this.fileSystemService,
			directory.path
		).read(DEFAULT_PROJECT_FILE);
		return project.isOk() && !project.value.takesRoutes;
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
		return project.isErr()
			? err(project.error)
			: ok({
					...chosen,
					project: await reader.withInitFolders(project.value),
				});
	}

	plan(choices: ProjectChoices, builder: InitPlanBuilder): void {
		const { language, darklua, sourcePaths, syncPath } = choices;
		const dirs = generatedDirs(choices);
		const derived = derivedRoutesOf(choices.tree, dirs);
		const routes = takesRoutes(choices.tree)
			? new StartingRoutes(language, derived).starting(
					choices.routes,
					choices.fallback
				)
			: undefined;
		const tree = TreePlan.of({
			tree: choices.tree,
			mounts: choices.mounts,
			dirs,
			derived,
			landings: Object.values(routes ?? {}),
		});
		const { compiler } = language;
		const { testRunner } = this.directory.workspace;
		const projects = projectsOf({
			language,
			darklua,
			syncPath,
			testRunner,
			inherited: tree.fields.globIgnorePaths ?? [],
		});
		const defaultSyncPath = darklua ? compiler?.outDir : syncPath;
		builder.setConfig(
			{
				...(choices.scaffold && {
					name: path.basename(this.directory.path),
				}),
				...tree.fields,
				...(routes && { sourcePaths: [...sourcePaths], routes }),
				...(choices.places && {
					placePaths: [...choices.places.placePaths],
				}),
				...(defaultSyncPath && { syncPath: defaultSyncPath }),
				...projects,
			},
			choices.tree.kind === "lift"
				? choices.tree.project.written
				: undefined
		);
		for (const sourcePath of sourcePaths) builder.addDirectory(sourcePath);
		for (const directory of choices.places?.directories ?? [])
			builder.addDirectory(directory);
		for (const note of choices.places?.notes ?? []) builder.addNote(note);
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
		const others = this.directory.otherProjectFiles(
			DEFAULT_PROJECT_FILE,
			...(choices.tree.kind === "lift" ? [choices.tree.from] : [])
		);
		if (others.length > 0)
			builder.addNote(
				`Left alone: ${others.join(", ")}. Rogen writes only default.project.json and the files named under "projects", and a project inherits the whole tree, so keep a file that holds a subset of it by hand, or add its name under "projects" in ${DEFAULT_CONFIG_FILE} to have Rogen write it.`
			);
		for (const warning of tree.warnings) builder.addWarning(warning);
		if (choices.tree.kind === "lift" && choices.unmounted?.length)
			builder.addWarning(
				ProjectSetup.unmountedWarning(
					choices.tree.from,
					choices.unmounted
				)
			);
		if (choices.scaffold)
			builder.addNote(
				`Starts from create-roblox-ts, which writes package.json, tsconfig.json and the compiler's settings.`
			);
		if (compiler && !darklua && syncPath) {
			builder.addNote(
				`Syncing from ${syncPath}, where ${compiler.name} compiles to.`
			);
		}
		if (projects.serveProject) {
			builder.addNote(
				`Studio syncs from ${syncPath}, where Darklua writes: rogen serve serves the ${projects.serveProject} project. default.project.json keeps pointing at ${defaultSyncPath ?? "your source"}, which luau-lsp and Darklua read.`
			);
		}
		if (testRunner) {
			builder.addNote(
				`Added a ${RELEASE_PROJECT} project that leaves the ${testRunner} specs out: rogen build writes ${RELEASE_PROJECT}.project.json beside default.project.json.`
			);
		}
		if (choices.sample)
			builder.addNote(
				choices.places
					? `Wrote the Greeter sample: the feature in ${choices.places.sharedSourcePath}, which every place shares, and Game in ${choices.places.placeSourcePath}. Pass --no-sample for empty source folders.`
					: `Wrote the Greeter sample in ${sourcePaths[0]}/Greeter, with the Baseplate of Rojo's sample in the tree. Pass --no-sample for an empty ${sourcePaths[0]}.`
			);
		this.planNextSteps(builder, choices, tree);
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
			`${files.length === 1 ? "1 file" : `${files.length} files`} in the source paths ${files.length === 1 ? "is" : "are"} mounted by no node, so Rojo ignored ${files.length === 1 ? "it" : "them"}, and Rogen's routes will place ${files.length === 1 ? "it" : "them"}: ${shown}${more > 0 ? ` and ${more} more` : ""}. Check where with 'rogen where <path>', and list ${files.length === 1 ? "it" : "them"} under "globIgnorePaths" to leave ${files.length === 1 ? "it" : "them"} out as Rojo did.`
		);
	}

	private planNextSteps(
		builder: InitPlanBuilder,
		{
			language,
			darklua,
			sourcePaths,
			syncPath,
			tree: chosen,
			places,
			luauLsp,
			gitignoreHint,
			scaffold,
		}: ProjectChoices,
		tree: TreePlan
	): void {
		const { compiler } = language;
		if (chosen.kind === "template") {
			builder.addRun(
				BUILD_COMMANDS[chosen.template](
					path.basename(this.directory.path)
				)
			);
			return;
		}
		const compiled = this.directory.defaultSourcePath(language);
		if (
			compiler &&
			!(scaffold && places) &&
			sourcePaths.length > 0 &&
			compiled !== sourcePaths[0]
		) {
			builder.addSetup(compiler.sourcePathStep(sourcePaths[0]));
		}
		builder.addEdit(...tree.edits);
		if (gitignoreHint) builder.addEdit(gitignoreHint);
		if (places)
			builder.addEdit(
				"Add another place with 'rogen init places/lobby'."
			);
		if (takesRoutes(chosen))
			builder.addEdit(
				`Add your own routes under "routes" in ${DEFAULT_CONFIG_FILE}.`
			);
		new SyncSteps(language, darklua, scaffold && "npm run watch").plan(
			builder,
			this.directory.path,
			{
				processed: compiler ? [compiler.outDir] : sourcePaths,
				syncPath,
				luauLsp: luauLsp === true,
			}
		);
	}
}
