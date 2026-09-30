import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { configFileName, defaultOutFileName } from "../config/config.js";
import { CompiledPlace, Language } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { BaseConfig, InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";

export interface PlaceChoices {
	readonly name: string;
	readonly folder: string;
}

/** What a place joins: the project's language, whether Darklua processes it, and what it inherits from its config. */
export interface PlaceJoin {
	readonly language: Language;
	readonly darklua: boolean;
	readonly base: BaseConfig;
}

/** A place extends `default.rogen.json` with its own root dir, syncing from its own subfolder when code is compiled or processed. */
export class PlaceSetup implements Setup {
	private constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions | undefined,
		private join: PlaceJoin | undefined,
		private choices: PlaceChoices | undefined
	) {}

	/** A place added beside an existing `default.rogen.json`, which asks for its name and folder. */
	static standalone(
		directory: InitDirectory,
		questions: InitQuestions
	): PlaceSetup {
		return new PlaceSetup(directory, questions, undefined, undefined);
	}

	/** A place a new project sets up alongside itself, which has nothing left to ask. */
	static within(
		directory: InitDirectory,
		join: PlaceJoin,
		choices: PlaceChoices
	): PlaceSetup {
		return new PlaceSetup(directory, undefined, join, choices);
	}

	get name(): string {
		return this.requireChoices().name;
	}

	async ask(): Promise<Result<boolean, Diagnostic[]>> {
		const { directory, questions } = this;
		if (!questions) return ok(true);

		const { workspace } = directory;
		const base = await directory.defaultConfig();
		if (base.isErr()) return err(base.error);

		const filesFor = (candidate: string) =>
			new ConfigSet(candidate, workspace.language, workspace.usesDarklua)
				.placeFiles;
		const given = directory.givenName;
		if (given) {
			const conflicts = directory.checkFree(filesFor(given));
			if (conflicts.length > 0) return err(conflicts);
		}
		const name =
			given ??
			(await questions.name(directory, {
				message: "Place name",
				description: "Writes <name>.rogen.json.",
				filesFor,
			}));
		if (name === undefined) return ok(false);

		const folder = await questions.placeFolder(directory, base.value, name);
		if (folder === undefined) return ok(false);

		this.join = {
			language: workspace.language,
			darklua: workspace.usesDarklua,
			base: base.value,
		};
		this.choices = { name, folder };
		return ok(true);
	}

	plan(builder: InitPlanBuilder): void {
		this.planFiles(builder);
		this.planSteps(builder);
		const { configSet, hasSourceParent } = this.layout();
		builder.addEdit(
			ConfigSet.tagsStep(
				configSet.language,
				hasSourceParent
					? configSet.editedFile
					: configFileName(configSet.name)
			)
		);
	}

	/** The configs, the compiler's own files and the one-time edits, which a project sets up for every place. */
	planFiles(builder: InitPlanBuilder): void {
		const { configSet, rootDirs, syncDir, compiled } = this.layout();
		const { name } = configSet;
		const { base } = this.requireJoin();

		const { sourceFile } = configSet;
		const parent = sourceFile ? base.parent : undefined;
		if (sourceFile && parent) {
			builder.addConfig(configSet.sourceStem, {
				extends: ConfigSet.reference(parent),
				rootDirs,
			});
			builder.addConfig(name, {
				extends: ConfigSet.reference(sourceFile),
				syncDir,
			});
		} else {
			builder.addConfig(name, {
				extends: ConfigSet.reference(ConfigSet.DEFAULT_FILE),
				rootDirs,
				...(syncDir && { syncDir }),
			});
		}
		for (const file of compiled?.files ?? []) builder.addCompilerFile(file);
		builder.addSetup(...(compiled?.setup ?? []));
	}

	/** The commands that build and serve the place; a project gives them for its first place only. */
	planSteps(builder: InitPlanBuilder): void {
		const {
			configSet,
			rootDirs,
			syncDir,
			compiled,
			outDir,
			hasSourceParent,
		} = this.layout();
		builder.addRun(
			...(compiled ? [compiled.compileCommand] : []),
			ConfigSet.watchCommand(
				hasSourceParent ? configSet.stems : [configSet.name]
			),
			ConfigSet.serveCommand(configSet.name)
		);
		if (configSet.darklua && syncDir) {
			builder.addDarkluaCommands(
				...this.directory.workspace.darklua.processCommands(
					this.directory.path,
					outDir ? [outDir] : rootDirs,
					syncDir
				)
			);
		}
	}

	/** What the place's own folder, its language and where its code is compiled or processed to come to. */
	private layout(): {
		readonly configSet: ConfigSet;
		readonly rootDirs: string[];
		readonly outDir: string | undefined;
		readonly syncDir: string | undefined;
		readonly compiled: CompiledPlace | undefined;
		readonly hasSourceParent: boolean;
	} {
		const { language, darklua, base } = this.requireJoin();
		const { name, folder } = this.requireChoices();
		const configSet = new ConfigSet(name, language, darklua);
		const { compiler } = language;
		const rootDirs = [...base.rootDirs, folder];

		const outDir = compiler && `${compiler.outDir}/${name}`;
		const syncBase =
			compiler || darklua
				? (base.syncDir ??
					compiler?.outDir ??
					this.directory.workspace.darklua.defaultSyncDir)
				: undefined;
		return {
			configSet,
			rootDirs,
			outDir,
			syncDir: syncBase && `${syncBase}/${name}`,
			compiled:
				compiler && outDir
					? compiler.planPlace({
							name,
							rootDirs,
							sharedRootDirs: base.rootDirs,
							outDir,
							projectFile: defaultOutFileName(name),
						})
					: undefined,
			hasSourceParent: Boolean(configSet.sourceFile && base.parent),
		};
	}

	private requireJoin(): PlaceJoin {
		if (!this.join) {
			throw new Error("A place is planned only once it was asked.");
		}
		return this.join;
	}

	private requireChoices(): PlaceChoices {
		if (!this.choices) {
			throw new Error("A place is planned only once it was asked.");
		}
		return this.choices;
	}
}
