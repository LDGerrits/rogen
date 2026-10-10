import { failureReason } from "../../base/errors.js";
import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { RogenConfig, configFileName } from "../config/config.js";
import { Darklua, Language, Mount } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import {
	InitQuestions,
	PlaceCount,
	SharedCode,
	UnusablePlace,
} from "./init-questions.js";
import { PlaceFolder, PlaceFolderReader } from "./place-folder.js";
import { PlacePlan } from "./place-plan.js";
import { TEMPLATE_FILE } from "./starter-template.js";
import { DerivedRoutes } from "./derived-routes.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import {
	ProjectTemplate,
	TemplatePlan,
	TemplateChoice,
} from "./template-plan.js";
import { Setup } from "./setup.js";

/** Every answer the new-project questions give, whether asked or defaulted. */
export interface ProjectChoices {
	readonly name: string;
	readonly language: Language;
	/** Darklua when it processes the code, else `undefined`. */
	readonly darklua: Darklua | undefined;
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	readonly template: ProjectTemplate;
	/** Where a new template starts; at the root when unset. */
	readonly templateDir?: string;
	readonly mounts: readonly Mount[];
	readonly routes: readonly RouteId[];
	/** Whether files that match no route go to the shared target, or are left out. */
	readonly fallback: boolean;
	/** Places set up alongside, each extending this config from a folder of its own. */
	readonly places: readonly ProjectPlace[];
	/** Place folders found that were left out, and why. */
	readonly unusablePlaces?: readonly UnusablePlace[];
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
	rootDirs: readonly string[],
	syncDir: string | undefined
): DerivedRoutes | undefined {
	return template.kind === "copy"
		? DerivedRoutes.of(template.from, template.content, [
				...rootDirs,
				...(syncDir ? [syncDir] : []),
			])
		: undefined;
}

/** A new project: a config, its template and project file, and any places that share its code. */
export class ProjectSetup implements Setup<ProjectChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		private readonly fileSystemService: FileReader,
		private readonly placeFolders: PlaceFolderReader
	) {}

	async ask(): Promise<Result<ProjectChoices | undefined, Diagnostic[]>> {
		const { directory, questions } = this;
		const identity = await this.askIdentity();
		if (identity.isErr()) return identity;
		if (identity.value === undefined) return ok(undefined);
		const { layout, name, language, darklua, configSet } = identity.value;

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
		const template = await this.resolveTemplate(chosen, templateDir);
		if (template.isErr()) return template;

		let syncDir = configSet.syncDir;
		if (darklua) {
			const answer = await questions.syncDir(directory, rootDirs);
			if (answer === undefined) return ok(undefined);
			syncDir = answer;
		}

		const mounts =
			template.value.kind === "use"
				? []
				: await questions.mounts(directory, language);
		if (mounts === undefined) return ok(undefined);

		const routes = await questions.routes(
			language,
			derivedRoutesOf(template.value, rootDirs, syncDir)
		);
		if (routes === undefined) return ok(undefined);

		const modes = await questions.modes(directory, language);
		if (modes === undefined) return ok(undefined);

		const places =
			layout === "several"
				? await this.askPlaces(identity.value, rootDirs, outputs)
				: { places: [], unusable: [] };
		if (places === undefined) return ok(undefined);

		return ok({
			name,
			language,
			darklua,
			rootDirs: [...rootDirs],
			...(syncDir && { syncDir }),
			template: template.value,
			...(templateDir && { templateDir }),
			mounts,
			routes: routes.routes,
			fallback: routes.fallback,
			places: places.places,
			...(places.unusable.length > 0 && {
				unusablePlaces: places.unusable,
			}),
			...(modes && { modes }),
		});
	}

	/** Who the project is: whether it has places, its name, language and Darklua, and that its config files are free. */
	private async askIdentity(): Promise<
		Result<
			| {
					readonly layout: PlaceCount;
					readonly name: string;
					readonly language: Language;
					readonly darklua: Darklua | undefined;
					readonly configSet: ConfigSet;
			  }
			| undefined,
			Diagnostic[]
		>
	> {
		const { directory, questions } = this;
		const firstRun = !directory.hasDefaultConfig;

		let layout: PlaceCount = "one";
		if (firstRun && directory.givenName === undefined) {
			const answer = await questions.placeCount(directory);
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
		return ok({ layout, name, language, darklua, configSet });
	}

	/** The template as the project gets it: a copied file is read, and a new one gives way to the shared template already there. */
	private async resolveTemplate(
		chosen: TemplateChoice,
		templateDir: string | undefined
	): Promise<Result<ProjectTemplate, Diagnostic[]>> {
		if (chosen.kind === "copy") {
			const copied = await this.readTemplate(chosen.from);
			return copied.isErr()
				? err(copied.error)
				: ok({ ...chosen, content: copied.value });
		}
		const shared = templateDir && `${templateDir}/${TEMPLATE_FILE}`;
		if (
			chosen.kind === "new" &&
			shared &&
			(await this.fileSystemService.exists(
				path.join(this.directory.path, shared)
			))
		)
			return ok({ kind: "use", file: shared });
		return ok(chosen);
	}

	/** The places of a project that shares code, each with what its folder already holds. */
	private async askPlaces(
		{
			configSet,
			language,
			darklua,
		}: {
			configSet: ConfigSet;
			language: Language;
			darklua: Darklua | undefined;
		},
		rootDirs: readonly string[],
		outputs: readonly string[]
	): Promise<
		| {
				readonly places: ProjectPlace[];
				readonly unusable: UnusablePlace[];
		  }
		| undefined
	> {
		const { directory } = this;
		const answer = await this.questions.places(directory, {
			rootDirs,
			filesFor: (place) =>
				new ConfigSet(place, language, darklua).placeFiles,
			reserved: new Set([
				...configSet.configFiles,
				...outputs,
				TEMPLATE_FILE,
			]),
		});
		if (answer === undefined) return undefined;
		const places = await Promise.all(
			answer.places.map(async (place) => ({
				name: place,
				folder: await this.placeFolders.read(
					directory.path,
					PlaceFolder.pathIn(directory, place, rootDirs)
				),
			}))
		);
		return { places, unusable: [...answer.unusable] };
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
		const derived = derivedRoutesOf(choices.template, rootDirs, syncDir);
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
		this.planProject(builder, choices, configSet, template, derived);
		const placePlans = this.planPlaces(builder, choices);
		this.planNextSteps(builder, choices, configSet, template, placePlans);
	}

	/** The project's own template, directories, configs and notes. */
	private planProject(
		builder: InitPlanBuilder,
		choices: ProjectChoices,
		configSet: ConfigSet,
		template: TemplatePlan,
		derived: DerivedRoutes | undefined
	): void {
		const { language, darklua, rootDirs, syncDir } = choices;
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
		for (const { place, problem } of choices.unusablePlaces ?? [])
			builder.addNote(`Didn't set up the place ${place}: ${problem}`);
		if (compiler && !darklua && syncDir) {
			builder.addNote(
				`Syncing from ${syncDir}, where ${compiler.name} compiles to.`
			);
		}
	}

	/** The files of every place, each on a port no other uses. */
	private planPlaces(
		builder: InitPlanBuilder,
		{ language, darklua, rootDirs, syncDir, places }: ProjectChoices
	): PlacePlan[] {
		const ports: number[] = [];
		const plans = places.map(({ name, folder }) => {
			const servePort = PlacePlan.freePort(ports);
			ports.push(servePort);
			return new PlacePlan(this.directory, {
				name,
				folder,
				servePort,
				language,
				darklua,
				base: { rootDirs, ...(syncDir && { syncDir }) },
			});
		});
		for (const plan of plans) plan.planFiles(builder);
		return plans;
	}

	/** What the user does next: the compiler's root dir, the edits, and the commands that build and serve. */
	private planNextSteps(
		builder: InitPlanBuilder,
		choices: ProjectChoices,
		configSet: ConfigSet,
		template: TemplatePlan,
		placePlans: readonly PlacePlan[]
	): void {
		const { name, language, rootDirs } = choices;
		const { compiler } = language;
		const compiled = this.directory.defaultRootDir(language);
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
			configSet.variantsStep
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
		{ rootDirs, syncDir }: ProjectChoices,
		configSet: ConfigSet
	): void {
		const { compiler } = configSet.language;
		configSet.planSteps(builder, this.directory.path, {
			compileCommand: compiler?.compileCommand,
			serveCommand: configSet.serveCommandBeside(
				this.directory.hasConfigs
			),
			processed: compiler ? [compiler.outDir] : rootDirs,
			syncDir,
		});
	}
}
