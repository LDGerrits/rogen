import { defaultOutFileName } from "../config/config.js";
import { CompiledPlace, Darklua, Language } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { BaseConfig, InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

/** A place's name and folder, and what it joins: the project's language, whether Darklua processes it, and what it inherits from its config. */
export interface PlaceChoices {
	readonly name: string;
	readonly folder: string;
	readonly language: Language;
	readonly darklua: Darklua | undefined;
	readonly base: BaseConfig;
}

/** What one place writes and says, which a place added later and every place of a new project share. */
export class PlacePlan {
	readonly configSet: ConfigSet;
	private readonly folder: string;
	private readonly rootDirs: string[];
	private readonly outDir: string | undefined;
	private readonly syncDir: string | undefined;
	private readonly compiled: CompiledPlace | undefined;

	constructor(
		private readonly directory: InitDirectory,
		{ name, folder, language, darklua, base }: PlaceChoices
	) {
		this.folder = folder;
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
		builder.addDirectory(this.folder);
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
