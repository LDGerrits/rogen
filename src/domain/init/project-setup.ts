import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { RogenConfig, configFileName, defaultOutFileName } from "../config/config.js";
import { Language, Mount } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory, TEMPLATE_FILE } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { Layout, InitQuestions } from "./init-questions.js";
import { PlaceSetup } from "./place-setup.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import { StarterTemplate, TemplateChoice } from "./starter-template.js";

/** Every answer the new-project questions give, whether asked or defaulted. */
export interface ProjectChoices {
	readonly name: string;
	readonly language: Language;
	readonly darklua: boolean;
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	/** Where the compiler writes; Darklua reads it when both are used. */
	readonly outDir?: string;
	readonly template: TemplateChoice;
	readonly mounts: readonly Mount[];
	readonly routes: readonly RouteId[];
	/** Whether files that match no route go to the shared target, or are left out. */
	readonly fallback: boolean;
	/** Places set up alongside, each extending this config from `places/<name>`. */
	readonly places: readonly string[];
}

/** Answers that are already known, so `ask` has nothing left to ask. */
export interface KnownProject {
	readonly choices: ProjectChoices;
	/** The contents of the file a `copy` template choice copies. */
	readonly copiedTemplate?: string;
}

interface PlannedTemplate {
	readonly file?: { readonly fileName: string; readonly content: string };
	/** What the configs name as their template. */
	readonly reference?: string;
	readonly notes: readonly string[];
	readonly edits: readonly string[];
}

const joinList = (items: readonly string[], conjunction: string): string =>
	items.length <= 1
		? items.join("")
		: `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;

/** A new project: a config, its template and project file, and any places that share its code. */
export class ProjectSetup implements Setup {
	private choices: ProjectChoices | undefined;
	private copiedTemplate: string | undefined;

	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		known?: KnownProject
	) {
		this.choices = known?.choices;
		this.copiedTemplate = known?.copiedTemplate;
	}

	/** What was chosen; `undefined` until `ask` has resolved. */
	get answers(): ProjectChoices | undefined {
		return this.choices;
	}

	async ask(): Promise<Result<boolean, Diagnostic[]>> {
		if (this.choices) return ok(true);
		const { directory, questions } = this;
		const firstRun = !directory.hasDefaultConfig;

		let layout: Layout = "one";
		if (firstRun && directory.givenName === undefined) {
			const answer = await questions.layout(directory);
			if (answer === undefined) return ok(false);
			layout = answer;
		}

		const name =
			directory.givenName ??
			(firstRun ? directory.name : await questions.configName(directory));
		if (name === undefined) return ok(false);

		const language = await questions.language(directory);
		if (language === undefined) return ok(false);
		const darklua = await questions.darklua(directory);
		if (darklua === undefined) return ok(false);

		const configSet = new ConfigSet(name, language, darklua);
		const conflicts = directory.checkFree(configSet.configFiles);
		if (conflicts.length > 0) return err(conflicts);

		const rootDirs = await questions.rootDirs(directory, language, layout);
		if (rootDirs === undefined) return ok(false);

		const outputs = configSet.outputFiles;
		const template = await questions.template(directory, outputs);
		if (template === undefined) return ok(false);

		let syncDir = configSet.syncDirBy(directory.workspace.darklua);
		if (darklua) {
			const answer = await questions.syncDir(directory);
			if (answer === undefined) return ok(false);
			syncDir = answer;
		}

		const mounts =
			template.kind === "use"
				? []
				: await questions.mounts(directory, language);
		if (mounts === undefined) return ok(false);

		const routes = await questions.routes(language);
		if (routes === undefined) return ok(false);

		let places: readonly string[] = [];
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
			if (answer === undefined) return ok(false);
			places = answer;
		}

		if (template.kind === "copy") {
			const copied = await directory.readFile(template.from);
			if (copied.isErr()) return err(copied.error);
			this.copiedTemplate = copied.value;
		}

		const outDir = language.compiler?.outDir;
		this.choices = {
			name,
			language,
			darklua,
			rootDirs,
			...(syncDir && { syncDir }),
			...(outDir && { outDir }),
			template,
			mounts,
			routes: routes.routes,
			fallback: routes.fallback,
			places,
		};
		return ok(true);
	}

	plan(builder: InitPlanBuilder): void {
		const choices = this.requireChoices();
		const { name, language, darklua, rootDirs, syncDir } = choices;
		const configSet = new ConfigSet(name, language, darklua);
		const template = this.planTemplate(choices, configSet);
		const starting = new StartingRoutes(language);
		const { compiler } = language;

		const starter = (starterSyncDir?: string): RogenConfig => ({
			rootDirs: [...rootDirs],
			routes: starting.starting(choices.routes, choices.fallback),
			...(template.reference && { template: template.reference }),
			...(starterSyncDir && { syncDir: starterSyncDir }),
		});

		if (template.file) builder.setTemplate(template.file);
		if (configSet.sourced) {
			builder.addConfig(name, starter());
			builder.addConfig(configSet.syncStem, {
				extends: ConfigSet.reference(configFileName(name)),
				...(syncDir && { syncDir }),
			});
		} else {
			builder.addConfig(name, starter(syncDir));
		}

		for (const note of template.notes) builder.addNote(note);
		if (compiler && !darklua && syncDir) {
			builder.addNote(
				`Syncing from ${syncDir}, where ${compiler.name} compiles to.`
			);
		}

		const places = choices.places.map((place) =>
			PlaceSetup.within(
				this.directory,
				{
					language,
					darklua,
					base: {
						rootDirs,
						...(syncDir && { syncDir }),
					},
				},
				{ name: place, folder: ConfigSet.placeFolderOf(place) }
			)
		);
		for (const place of places) place.planFiles(builder);

		// The first place's commands stand for all of them.
		const [first, ...others] = places;
		if (first) {
			builder.addEdit(
				...(others.length > 0
					? [
							`Swap ${first.name} for ${others.map(({ name }) => name).join(" or ")} to work on another place.`,
						]
					: [])
			);
		}
		builder.addEdit(...template.edits);
		builder.addEdit(
			`Add your own routes under "routes" in ${configFileName(name)}.`,
			ConfigSet.tagsStep(language, configFileName(name))
		);
		if (first) first.planSteps(builder);
		else this.planSteps(builder, choices, configSet);
	}

	private requireChoices(): ProjectChoices {
		if (!this.choices)
			throw new Error("A project is planned only once it was asked.");
		return this.choices;
	}

	/** The commands that build and serve the project itself. */
	private planSteps(
		builder: InitPlanBuilder,
		{ rootDirs, syncDir, outDir }: ProjectChoices,
		configSet: ConfigSet
	): void {
		const { name, language, darklua, stems } = configSet;
		const { compiler } = language;
		const processed = compiler
			? [outDir ?? compiler.defaultOutDir]
			: rootDirs;
		builder.addRun(
			...(compiler ? [compiler.compileCommand] : []),
			// Darklua reads the source-rooted project, so both are kept current.
			ConfigSet.watchCommand(stems),
			ConfigSet.serveCommand(configSet.servedStem)
		);
		if (darklua && syncDir) {
			builder.addDarkluaCommands(
				...this.directory.workspace.darklua.processCommands(
					this.directory.path,
					processed,
					syncDir
				)
			);
		}
		if (configSet.sourced) {
			builder.addSourcemapSteps(
				defaultOutFileName(name),
				this.directory.workspace.darklua
			);
		}
	}

	private planTemplate(
		{ template, mounts, rootDirs, syncDir, places }: ProjectChoices,
		configSet: ConfigSet
	): PlannedTemplate {
		const { directory } = this;
		if (directory.has(TEMPLATE_FILE)) {
			const handWritten = directory.handWrittenProjectFiles;
			const replaced = configSet.outputFiles.filter((file) =>
				handWritten.includes(file)
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
			return this.copyTemplate(template.from, mounts, [
				...rootDirs,
				...(syncDir ? [syncDir] : []),
				...places.map(ConfigSet.placeFolderOf),
			]);
		}
		if (template.kind === "use") {
			return {
				reference: template.file,
				notes: [`Using ${template.file} as the template.`],
				edits: [],
			};
		}

		const started = StarterTemplate.fromMounts(
			directory.projectName,
			mounts
		);
		if (!started) return { notes: [], edits: [] };
		return {
			file: { fileName: TEMPLATE_FILE, content: started.toJson() },
			reference: TEMPLATE_FILE,
			notes: [],
			edits: [],
		};
	}

	/** `dirs` are the folders Rogen generates nodes for now, which the copy leaves out. */
	private copyTemplate(
		from: string,
		mounts: readonly Mount[],
		dirs: readonly string[]
	): PlannedTemplate {
		const content = this.copiedTemplate ?? "";
		const parsed = StarterTemplate.parse(content);
		const stripped = parsed?.withoutNodesIn(dirs);
		const mounted = (stripped?.template ?? parsed)?.withMounts(mounts);
		const removed = stripped?.removed ?? [];
		const added = mounted?.added ?? [];
		const skipped = mounted?.skipped ?? [];
		return {
			file: {
				fileName: TEMPLATE_FILE,
				// Rewriting would drop comments and formatting, so only do it when something changed.
				content:
					mounted && removed.length + added.length > 0
						? mounted.template.toJson()
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
				...(parsed || mounts.length === 0
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
}
