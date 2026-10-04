import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	DEFAULT_CONFIG_STEM,
	configFileName,
	defaultOutFileName,
} from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { CompiledPlace, Darklua, Language } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { BaseConfig, InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";

/** A place's name and folder, and what it joins: the project's language, whether Darklua processes it, and what it inherits from its config. */
export interface PlaceChoices {
	readonly name: string;
	readonly folder: string;
	readonly language: Language;
	readonly darklua: Darklua | undefined;
	readonly base: BaseConfig;
}

/** A place extends `default.rogen.json` with its own root dir, syncing from its own subfolder when code is compiled or processed. */
export class PlaceSetup implements Setup<PlaceChoices> {
	constructor(
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions
	) {}

	/** Asks for the name and folder of a place added beside an existing `default.rogen.json`. */
	async ask(): Promise<Result<PlaceChoices | undefined, Diagnostic[]>> {
		const { directory, questions } = this;

		const { workspace, base } = directory;
		if (!base) {
			throw new Error(
				"A place joins default.rogen.json, which init only offers when it exists."
			);
		}
		if (base.isErr()) return err(base.error);

		const filesFor = (candidate: string) =>
			new ConfigSet(
				candidate,
				workspace.language,
				workspace.detectedDarklua
			).placeFiles;
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
		if (name === undefined) return ok(undefined);

		const folder = await questions.placeFolder(directory, base.value, name);
		if (folder === undefined) return ok(undefined);
		// A run that can't ask takes the default folder unchecked.
		const problem = directory.placeFolderProblem(
			base.value.rootDirs,
			folder
		);
		if (problem) {
			return err([
				errorDiagnostic(
					"init.invalidPlaceFolder",
					{ resource: path.join(directory.path, folder) },
					problem
				),
			]);
		}

		return ok({
			name,
			folder,
			language: workspace.language,
			darklua: workspace.detectedDarklua,
			base: base.value,
		});
	}

	plan(choices: PlaceChoices, builder: InitPlanBuilder): void {
		this.planFiles(choices, builder);
		this.planSteps(choices, builder);
		const { configSet } = this.layout(choices);
		builder.addEdit(
			ConfigSet.tagsStep(
				configSet.language,
				configFileName(configSet.name)
			)
		);
	}

	/** The configs, the compiler's own files and the one-time edits, which a project sets up for every place. */
	planFiles(choices: PlaceChoices, builder: InitPlanBuilder): void {
		const { configSet, rootDirs, syncDir, compiled } = this.layout(choices);
		configSet.planConfigs(
			builder,
			{
				extends: ConfigSet.reference(ConfigSet.DEFAULT_FILE),
				rootDirs,
			},
			syncDir
		);
		for (const file of compiled?.files ?? []) builder.addCompilerFile(file);
		builder.addSetup(...(compiled?.setup ?? []));
	}

	/** The commands that build and serve the place; a project gives them for its first place only. */
	planSteps(choices: PlaceChoices, builder: InitPlanBuilder): void {
		const { configSet, rootDirs, syncDir, compiled, outDir } =
			this.layout(choices);
		configSet.planSteps(builder, this.directory, {
			compileCommand: compiled?.compileCommand,
			processed: outDir ? [outDir] : rootDirs,
			syncDir,
		});
	}

	/** What the place's own folder, its language and where its code is compiled or processed to come to. */
	private layout({ name, folder, language, darklua, base }: PlaceChoices): {
		readonly configSet: ConfigSet;
		readonly rootDirs: string[];
		readonly outDir: string | undefined;
		readonly syncDir: string | undefined;
		readonly compiled: CompiledPlace | undefined;
	} {
		const configSet = new ConfigSet(name, language, darklua);
		const { compiler } = language;
		const rootDirs = [...base.rootDirs, folder];

		const outDir = compiler && `${compiler.outDir}/${name}`;
		const syncBase =
			compiler || darklua
				? (base.syncDir ?? compiler?.outDir ?? darklua?.defaultSyncDir)
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
		};
	}
}

/** Reads what a place inherits from the configs already in a directory. */
export class BaseConfigReader {
	constructor(
		private readonly configService: ConfigService,
		/** The absolute path of the directory. */
		private readonly directory: string
	) {}

	/** `default.rogen.json` resolved the way a build would, so a place joins a config that builds. A Darklua repo's default is source-rooted, so its sync dir comes from the synced config beside it. */
	async read(
		entries: ReadonlySet<string>
	): Promise<Result<BaseConfig, Diagnostic[]>> {
		const entry = await this.configService.read(
			path.join(this.directory, configFileName(DEFAULT_CONFIG_STEM))
		);
		if (entry.status === "broken") return err([...entry.errors]);

		const { rootDirs } = entry.config;
		const syncFile = configFileName(
			ConfigSet.syncStemOf(DEFAULT_CONFIG_STEM)
		);
		const syncDir =
			entry.config.syncDir ??
			(entries.has(syncFile)
				? await this.syncDirOf(syncFile)
				: undefined);
		return ok({
			rootDirs: rootDirs.map((dir) => this.relative(dir)),
			...(syncDir && { syncDir: this.relative(syncDir) }),
		});
	}

	/** The absolute sync dir the config in `fileName` resolves to, if it has one and builds. */
	private async syncDirOf(fileName: string): Promise<string | undefined> {
		const entry = await this.configService.read(
			path.join(this.directory, fileName)
		);
		return entry.status === "valid" ? entry.config.syncDir : undefined;
	}

	private relative(absolute: string): string {
		return toPosix(path.relative(this.directory, absolute));
	}
}
