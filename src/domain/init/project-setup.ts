import { Result, err, ok } from "../../base/result.js";
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
import { Darklua, Language, Mount } from "../toolchain/toolchain.js";
import { DerivedRoutes } from "./derived-routes.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { ProjectReader } from "./project-reader.js";
import { Setup } from "./setup.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
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
	return tree.kind === "new" || tree.project.takesRoutes;
}

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

		const routed = takesRoutes(tree.value);
		const mounts = routed
			? await questions.mounts(directory, language)
			: [];
		if (mounts === undefined) return ok(undefined);

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

		return ok({
			language,
			darklua,
			sourcePaths: [...sourcePaths],
			...(syncPath && { syncPath }),
			tree: tree.value,
			mounts,
			routes: routes.routes,
			fallback: routes.fallback,
			unmounted,
		});
	}

	private async resolveTree(
		chosen: TreeChoice
	): Promise<Result<ProjectTree, Diagnostic[]>> {
		if (chosen.kind === "new") return ok(chosen);
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
		builder.setConfig({
			...tree.fields,
			...(routes && { sourcePaths: [...sourcePaths], routes }),
			...(defaultSyncPath && { syncPath: defaultSyncPath }),
			...projects,
		});
		for (const sourcePath of sourcePaths) builder.addDirectory(sourcePath);
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
		}: ProjectChoices,
		tree: TreePlan
	): void {
		const { compiler } = language;
		const compiled = this.directory.defaultSourcePath(language);
		if (compiler && compiled !== sourcePaths[0]) {
			builder.addSetup(compiler.sourcePathStep(sourcePaths[0]));
		}
		builder.addEdit(...tree.edits);
		if (takesRoutes(chosen))
			builder.addEdit(
				`Add your own routes under "routes" in ${DEFAULT_CONFIG_FILE}.`
			);
		new SyncSteps(language, darklua).plan(builder, this.directory.path, {
			processed: compiler ? [compiler.outDir] : sourcePaths,
			syncPath,
		});
	}
}
