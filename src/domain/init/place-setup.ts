import path from "path";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { configFileName, defaultOutFileName } from "../config/config.js";
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
		/** The `default.rogen.json` the place joins, as it was read. */
		private readonly base: Result<BaseConfig, Diagnostic[]>,
		private readonly questions: InitQuestions
	) {}

	/** Asks for the name and folder of a place added beside an existing `default.rogen.json`. */
	async ask(): Promise<Result<PlaceChoices | undefined, Diagnostic[]>> {
		const { directory, base, questions } = this;
		const { workspace } = directory;
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
		const place = new PlacePlan(this.directory, choices);
		place.planFiles(builder);
		place.planSteps(builder);
		builder.addEdit(
			ConfigSet.variantsStep(
				place.configSet.language,
				configFileName(place.configSet.name)
			)
		);
	}
}

/** What one place writes and says, which a place added later and every place of a new project share. */
export class PlacePlan {
	readonly configSet: ConfigSet;
	private readonly rootDirs: string[];
	private readonly outDir: string | undefined;
	private readonly syncDir: string | undefined;
	private readonly compiled: CompiledPlace | undefined;

	constructor(
		private readonly directory: InitDirectory,
		{ name, folder, language, darklua, base }: PlaceChoices
	) {
		this.configSet = new ConfigSet(name, language, darklua);
		const { compiler } = language;
		this.rootDirs = [...base.rootDirs, folder];
		this.outDir = compiler && `${compiler.outDir}/${name}`;
		const syncBase =
			this.configSet.syncDir && (base.syncDir ?? this.configSet.syncDir);
		this.syncDir = syncBase && `${syncBase}/${name}`;
		this.compiled =
			compiler && this.outDir
				? compiler.planPlace({
						name,
						rootDirs: this.rootDirs,
						sharedRootDirs: base.rootDirs,
						outDir: this.outDir,
						projectFile: defaultOutFileName(name),
					})
				: undefined;
	}

	/** The configs, the compiler's own files and the one-time edits, which a project sets up for every place. */
	planFiles(builder: InitPlanBuilder): void {
		const { configSet, rootDirs, syncDir, compiled } = this;
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
	planSteps(builder: InitPlanBuilder): void {
		const { configSet, rootDirs, syncDir, compiled, outDir } = this;
		configSet.planSteps(builder, this.directory, {
			compileCommand: compiled?.compileCommand,
			processed: outDir ? [outDir] : rootDirs,
			syncDir,
		});
	}
}
