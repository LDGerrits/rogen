import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileSystemService,
	failureReason,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { RogenConfig, configFileName } from "../config/config.js";
import { Darklua, Language, Mount } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions, Layout, SharedCode } from "./init-questions.js";
import { PlaceFolder, PlaceFolders } from "./place-folder.js";
import { PlaceChoices, PlacePlan } from "./place-plan.js";
import { TEMPLATE_FILE } from "./starter-template.js";
import { DerivedRoutes } from "./derived-routes.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import { ProjectTemplate, TemplatePlan } from "./template-plan.js";

/** Every answer the new-project questions give, whether asked or defaulted. */
export interface ProjectChoices {
	readonly name: string;
	readonly language: Language;
	/** Darklua when it processes the code, else `undefined`. */
	readonly darklua: Darklua | undefined;
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	/** Where the compiler writes; Darklua reads it when both are used. */
	readonly outDir?: string;
	readonly template: ProjectTemplate;
	/** Where a new template starts; at the root when unset. */
	readonly templateDir?: string;
	readonly mounts: readonly Mount[];
	readonly routes: readonly RouteId[];
	/** Whether files that match no route go to the shared target, or are left out. */
	readonly fallback: boolean;
	/** Places set up alongside, each extending this config from a folder of its own. */
	readonly places: readonly ProjectPlace[];
	/** Whether the config declares dev and prod modes, the prod one leaving out specs. */
	readonly modes?: boolean;
}

/** A place a new project sets up, and what its folder already holds. */
export interface ProjectPlace {
	readonly name: string;
	readonly folder: PlaceFolder;
}

/** The routes the nodes a copied project file loses become; asking and planning both read them from here, so the ids they use agree. */
function derivedRoutesOf(
	template: ProjectTemplate,
	rootDirs: readonly string[]
): DerivedRoutes | undefined {
	return template.kind === "copy"
		? DerivedRoutes.of(template.from, template.content, rootDirs)
		: undefined;
}

/** A new project: a config, its template and project file, and any places that share its code. */
export class ProjectSetup implements Setup<ProjectChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		private readonly fileSystemService: FileSystemService,
		private readonly placeFolders: PlaceFolders
	) {}

	async ask(): Promise<Result<ProjectChoices | undefined, Diagnostic[]>> {
		const { directory, questions } = this;
		const firstRun = !directory.hasDefaultConfig;

		let layout: Layout = "one";
		if (firstRun && directory.givenName === undefined) {
			const answer = await questions.layout(directory);
			if (answer === undefined) return ok(undefined);
			layout = answer;
		}

		const name =
			directory.givenName ??
			(firstRun ? directory.name : await questions.configName(directory));
		if (name === undefined) return ok(undefined);

		const language = await questions.language(directory);
		if (language === undefined) return ok(undefined);
		const usesDarklua = await questions.darklua(directory);
		if (usesDarklua === undefined) return ok(undefined);
		const darklua = usesDarklua ? directory.workspace.darklua : undefined;

		const configSet = new ConfigSet(name, language, darklua);
		const conflicts = directory.checkFree(configSet.configFiles);
		if (conflicts.length > 0) return err(conflicts);

		const shared: SharedCode | undefined =
			layout === "several"
				? await questions.sharedCode(directory, language)
				: await questions
						.rootDirs(directory, language)
						.then((rootDirs) => rootDirs && { rootDirs });
		if (shared === undefined) return ok(undefined);
		const { rootDirs, templateDir } = shared;

		const outputs = configSet.outputFiles;
		const chosen = await questions.template(directory, outputs);
		if (chosen === undefined) return ok(undefined);
		let template: ProjectTemplate;
		const sharedTemplate = templateDir && `${templateDir}/${TEMPLATE_FILE}`;
		if (chosen.kind === "copy") {
			const copied = await this.readTemplate(chosen.from);
			if (copied.isErr()) return err(copied.error);
			template = { ...chosen, content: copied.value };
		} else if (
			chosen.kind === "new" &&
			sharedTemplate &&
			(await this.fileSystemService.exists(
				path.join(directory.path, sharedTemplate)
			))
		)
			template = { kind: "use", file: sharedTemplate };
		else template = chosen;

		let syncDir = configSet.syncDir;
		if (darklua) {
			const answer = await questions.syncDir(directory);
			if (answer === undefined) return ok(undefined);
			syncDir = answer;
		}

		const mounts =
			template.kind === "use"
				? []
				: await questions.mounts(directory, language);
		if (mounts === undefined) return ok(undefined);

		const routes = await questions.routes(
			language,
			derivedRoutesOf(template, rootDirs)
		);
		if (routes === undefined) return ok(undefined);

		const modes = await questions.modes(directory, language);
		if (modes === undefined) return ok(undefined);

		let places: readonly ProjectPlace[] = [];
		if (layout === "several") {
			const answer = await questions.places(directory, {
				rootDirs,
				filesFor: (place) =>
					new ConfigSet(place, language, darklua).placeFiles,
				reserved: new Set([
					...configSet.configFiles,
					...outputs,
					TEMPLATE_FILE,
				]),
			});
			if (answer === undefined) return ok(undefined);
			places = await Promise.all(
				answer.map(async (place) => ({
					name: place,
					folder: await this.placeFolders.read(
						directory.path,
						PlaceFolder.pathIn(directory, place, rootDirs)
					),
				}))
			);
		}

		const outDir = language.compiler?.outDir;
		return ok({
			name,
			language,
			darklua,
			rootDirs: [...rootDirs],
			...(syncDir && { syncDir }),
			...(outDir && { outDir }),
			template,
			...(templateDir && { templateDir }),
			mounts,
			routes: routes.routes,
			fallback: routes.fallback,
			places,
			...(modes && { modes }),
		});
	}

	/** The file a `copy` template choice copies, as it is. */
	private async readTemplate(
		fileName: string
	): Promise<Result<string, Diagnostic[]>> {
		const file = path.join(this.directory.path, fileName);
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		return text.isOk()
			? text
			: err([
					errorDiagnostic(
						"init.templateUnreadable",
						{ resource: file },
						isMissingPath(text.error)
							? "this file does not exist, so it can't be copied."
							: `couldn't read this file to copy it: ${failureReason(text.error)}.`
					),
				]);
	}

	plan(choices: ProjectChoices, builder: InitPlanBuilder): void {
		const { name, language, darklua, rootDirs, syncDir } = choices;
		const configSet = new ConfigSet(name, language, darklua);
		const derived = derivedRoutesOf(choices.template, rootDirs);
		const template = TemplatePlan.of(this.directory, configSet, {
			template: choices.template,
			templateDir: choices.templateDir,
			mounts: choices.mounts,
			dirs: [
				...rootDirs,
				...(syncDir ? [syncDir] : []),
				...choices.places.map(({ folder }) => folder.path),
			],
			derived,
		});
		const starting = new StartingRoutes(language, derived);
		const { compiler } = language;

		const starter: RogenConfig = {
			rootDirs: [...rootDirs],
			routes: starting.starting(choices.routes, choices.fallback),
			...(choices.modes && {
				mode: "dev",
				modes: {
					dev: {},
					prod: { exclude: [ConfigSet.specGlobOf(language)] },
				},
			}),
			...(template.reference && { template: template.reference }),
		};

		if (template.file) builder.setTemplate(template.file);
		for (const rootDir of rootDirs) builder.addDirectory(rootDir);
		configSet.planConfigs(builder, starter, syncDir);

		for (const note of template.notes) builder.addNote(note);
		if (compiler && !darklua && syncDir) {
			builder.addNote(
				`Syncing from ${syncDir}, where ${compiler.name} compiles to.`
			);
		}

		const ports: number[] = [];
		const places = choices.places.map(({ name, folder }): PlaceChoices => {
			const servePort = PlacePlan.freePort(ports);
			ports.push(servePort);
			return {
				name,
				folder,
				servePort,
				language,
				darklua,
				base: { rootDirs, ...(syncDir && { syncDir }) },
			};
		});
		const placePlans = places.map(
			(place) => new PlacePlan(this.directory, place)
		);
		for (const place of placePlans) place.planFiles(builder);
		const compiled =
			language.configuredRootDir() ??
			this.directory.defaultRootDir(language);
		if (compiler && compiled !== rootDirs[0]) {
			builder.addSetup(compiler.rootDirStep(rootDirs[0]));
		}
		builder.addEdit(...template.edits);
		if (choices.modes) {
			builder.addEdit(
				`Build a release without specs with rogen build --mode prod; ${configFileName(name)} declares the modes.`
			);
		}
		builder.addEdit(
			`Add your own routes under "routes" in ${configFileName(name)}.`,
			ConfigSet.variantsStep(language, configFileName(name))
		);
		const serveCommand = PlacePlan.serveCommandOf(placePlans);
		placePlans.forEach((place, index) =>
			place.planSteps(builder, serveCommand, index === 0)
		);
		if (placePlans.length === 0)
			this.planSteps(builder, choices, configSet);
	}

	/** The commands that build and serve the project itself. */
	private planSteps(
		builder: InitPlanBuilder,
		{ rootDirs, syncDir, outDir }: ProjectChoices,
		configSet: ConfigSet
	): void {
		const { compiler } = configSet.language;
		configSet.planSteps(builder, this.directory, {
			compileCommand: compiler?.compileCommand,
			processed: compiler ? [outDir ?? compiler.defaultOutDir] : rootDirs,
			syncDir,
		});
	}
}
