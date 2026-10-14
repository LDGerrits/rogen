import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	DEFAULT_CONFIG_FILE,
	ProjectChanges,
	RogenConfig,
} from "../config/config.js";
import { Darklua, Language, Mount } from "../toolchain/toolchain.js";
import { DerivedRoutes } from "./derived-routes.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { ProjectReader } from "./project-reader.js";
import { Setup } from "./setup.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import { SyncSteps } from "./sync-steps.js";
import { ProjectTree, TreeChoice, TreePlan } from "./tree-plan.js";

/** Every answer the new-project questions give, whether asked or defaulted. */
export interface ProjectChoices {
	readonly language: Language;
	/** Darklua when it processes the code, else `undefined`. */
	readonly darklua: Darklua | undefined;
	readonly sourcePaths: readonly string[];
	readonly syncPath?: string;
	readonly tree: ProjectTree;
	readonly mounts: readonly Mount[];
	readonly routes: readonly RouteId[];
	/** Whether files that match no route go to the shared target, or are left out. */
	readonly fallback: boolean;
}

/** The routes the nodes a lifted project file loses become; asking and planning both read them from here, so the ids they use agree. */
function derivedRoutesOf(
	tree: ProjectTree,
	dirs: readonly string[]
): DerivedRoutes | undefined {
	return tree.kind === "lift"
		? DerivedRoutes.of(tree.from, tree.project, dirs)
		: undefined;
}

/** The folders Rogen generates the code of: the source paths, what is synced, and a compiler's output when Darklua processes it. */
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

/** The project that Studio syncs from when Darklua processes the code. */
const PROCESSED_PROJECT = "dist";

/** The project that leaves the specs out. */
const RELEASE_PROJECT = "release";

/** The keys of a new project's config that name its projects: Darklua's output is served, and a test runner's specs are left out of a release. */
function projectsOf({
	language,
	darklua,
	syncPath,
	testRunner,
	inherited,
}: Pick<ProjectChoices, "language" | "darklua" | "syncPath"> & {
	readonly testRunner: string | undefined;
	/** The globs the lifted project file already ignores. */
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

/** A new project: its `rogen.json`, with the tree it starts from. */
export class ProjectSetup implements Setup<ProjectChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		private readonly fileSystemService: FileReader
	) {}

	async ask(): Promise<Result<ProjectChoices | undefined, Diagnostic[]>> {
		const { directory, questions } = this;
		const language = await questions.language(directory);
		if (language === undefined) return ok(undefined);
		const usesDarklua = await questions.darklua(directory);
		if (usesDarklua === undefined) return ok(undefined);
		const darklua = usesDarklua ? directory.workspace.darklua : undefined;

		const sourcePaths = await questions.sourcePaths(directory, language);
		if (sourcePaths === undefined) return ok(undefined);

		const chosen = await questions.tree(directory);
		if (chosen === undefined) return ok(undefined);
		const tree = await this.resolveTree(chosen);
		if (tree.isErr()) return tree;

		let syncPath = new SyncSteps(language, darklua).syncPath;
		if (darklua) {
			const answer = await questions.syncPath(directory, [
				...sourcePaths,
				...(language.compiler ? [language.compiler.outDir] : []),
			]);
			if (answer === undefined) return ok(undefined);
			syncPath = answer;
		}

		const mounts = await questions.mounts(directory, language);
		if (mounts === undefined) return ok(undefined);

		const routes = await questions.routes(
			language,
			derivedRoutesOf(
				tree.value,
				generatedDirs({ language, darklua, sourcePaths, syncPath })
			)
		);
		if (routes === undefined) return ok(undefined);

		return ok({
			language,
			darklua,
			sourcePaths: [...sourcePaths],
			...(syncPath && { syncPath }),
			tree: tree.value,
			mounts,
			routes: routes.routes,
			fallback: routes.fallback,
		});
	}

	/** The tree as the project gets it: a lifted file is read. */
	private async resolveTree(
		chosen: TreeChoice
	): Promise<Result<ProjectTree, Diagnostic[]>> {
		if (chosen.kind === "new") return ok(chosen);
		const project = await new ProjectReader(
			this.fileSystemService,
			this.directory.path
		).read(chosen.from);
		return project.isErr()
			? err(project.error)
			: ok({ ...chosen, project: project.value });
	}

	plan(choices: ProjectChoices, builder: InitPlanBuilder): void {
		const { language, darklua, sourcePaths, syncPath } = choices;
		const dirs = generatedDirs(choices);
		const derived = derivedRoutesOf(choices.tree, dirs);
		const tree = TreePlan.of({
			tree: choices.tree,
			mounts: choices.mounts,
			dirs,
			derived,
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
		// With Darklua the default project keeps pointing at the code the compiler writes, or at the source, for the tools that read it.
		const defaultSyncPath = darklua ? compiler?.outDir : syncPath;
		builder.setConfig({
			...tree.fields,
			sourcePaths: [...sourcePaths],
			routes: new StartingRoutes(language, derived).starting(
				choices.routes,
				choices.fallback
			),
			...(defaultSyncPath && { syncPath: defaultSyncPath }),
			...projects,
		});
		for (const sourcePath of sourcePaths) builder.addDirectory(sourcePath);
		for (const note of tree.notes) builder.addNote(note);
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
		this.planNextSteps(builder, choices, tree);
	}

	/** What the user does next: the compiler's source path, the edits, and the commands that build and serve. */
	private planNextSteps(
		builder: InitPlanBuilder,
		{ language, darklua, sourcePaths, syncPath }: ProjectChoices,
		tree: TreePlan
	): void {
		const { compiler } = language;
		const compiled = this.directory.defaultSourcePath(language);
		if (compiler && compiled !== sourcePaths[0]) {
			builder.addSetup(compiler.sourcePathStep(sourcePaths[0]));
		}
		builder.addEdit(...tree.edits);
		builder.addEdit(
			`Add your own routes under "routes" in ${DEFAULT_CONFIG_FILE}.`
		);
		new SyncSteps(language, darklua).plan(builder, this.directory.path, {
			processed: compiler ? [compiler.outDir] : sourcePaths,
			syncPath,
		});
	}
}
