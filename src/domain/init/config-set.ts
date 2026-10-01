import { Result, err, ok } from "../../base/result.js";
import {
	DEFAULT_CONFIG_STEM,
	RogenConfig,
	configFileName,
	defaultOutFileName,
} from "../config/config.js";
import { Darklua, Language, PLACES_DIR } from "../toolchain/toolchain.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";

/** The template project file `init` starts, which the configs it writes name. */
export const TEMPLATE_FILE = "template.project.json";

/** The names `init` writes for one config name; a Darklua repo without a compiler gets the named config, rooted at the source for luau-lsp and Darklua, and a synced one to serve. */
export class ConfigSet {
	/** The config a project starts with. */
	static readonly DEFAULT_FILE = configFileName(DEFAULT_CONFIG_STEM);

	constructor(
		readonly name: string,
		readonly language: Language,
		readonly darklua: boolean
	) {}

	/** The stem of the synced config beside `name`'s source-rooted one. */
	static syncStemOf(name: string): string {
		return name === DEFAULT_CONFIG_STEM ? "sync" : `${name}-sync`;
	}

	/** Project files in `directory` that no config beside them writes, other than the template. */
	static handWrittenProjectFiles(directory: InitDirectory): string[] {
		return directory.projectFilesWithoutConfig.filter(
			(file) => file !== TEMPLATE_FILE
		);
	}

	/** `extends` as init writes it: relative, and explicitly so. */
	static reference(file: string): string {
		return `./${file}`;
	}

	/** Where a place named `name` keeps its own code. */
	static placeFolderOf(name: string): string {
		return `${PLACES_DIR}/${name}`;
	}

	/** The files a variant named `name` writes, plus its project file. */
	static variantFilesOf(name: string): string[] {
		return [configFileName(name), defaultOutFileName(name)];
	}

	/** The command that serves the project file the config named `name` writes. */
	static serveCommand(name: string): string {
		return `rojo serve ${defaultOutFileName(name)}`;
	}

	/** The command that watches the configs with these stems. */
	static watchCommand(stems: readonly string[]): string {
		return stems.length === 1 && stems[0] === DEFAULT_CONFIG_STEM
			? "rogen watch"
			: `rogen watch ${stems.join(" ")}`;
	}

	/** Says where variants of a script are swapped in, in the words the next steps use. */
	static tagsStep(language: Language, configFile: string): string {
		return `Add tags under "tags" in ${configFile} to swap in variants like Analytics.mock.${language.extension}.`;
	}

	/** `names` are the positionals after `init`. */
	static parseName(names: readonly string[]): Result<string, Error> {
		if (names.length > 1) {
			return err(new Error("init takes at most one config name."));
		}
		const [name = DEFAULT_CONFIG_STEM] = names;
		if (name.trim() === "") {
			return err(new Error("A config name can't be empty."));
		}
		if (name === "." || name === ".." || /[\\/]/.test(name)) {
			return err(
				new Error(
					`"${name}" is not a valid config name: it can't contain path separators.`
				)
			);
		}
		if (defaultOutFileName(name) === TEMPLATE_FILE) {
			return err(
				new Error(
					`"${name}" is not a valid config name: it would write over ${TEMPLATE_FILE}.`
				)
			);
		}
		return ok(name);
	}

	/** The sync dir written for a config: Darklua's output, else the compiler's, else none. */
	syncDirBy(darkluaTool: Darklua): string | undefined {
		return this.darklua
			? darkluaTool.defaultSyncDir
			: this.language.compiler?.outDir;
	}

	/** Whether a synced config is written beside the named one. */
	get sourced(): boolean {
		return this.darklua && this.language.compiler === undefined;
	}

	get syncStem(): string {
		return ConfigSet.syncStemOf(this.name);
	}

	/** The synced config's file, when there is one. */
	get syncFile(): string | undefined {
		return this.sourced ? configFileName(this.syncStem) : undefined;
	}

	/** The stems of its configs, in the order they're written. */
	get stems(): string[] {
		return this.sourced ? [this.name, this.syncStem] : [this.name];
	}

	get configFiles(): string[] {
		return this.stems.map(configFileName);
	}

	get outputFiles(): string[] {
		return this.stems.map(defaultOutFileName);
	}

	/** The config whose project file Rojo serves: the synced one, when there is one. */
	get servedStem(): string {
		return this.sourced ? this.syncStem : this.name;
	}

	/** Writes `own`, which carries the sync dir; a sourced set keeps `own` rooted at the source, and a second config extending it takes the sync dir. */
	planConfigs(
		builder: InitPlanBuilder,
		own: RogenConfig,
		syncDir?: string
	): void {
		if (this.sourced) {
			builder.addConfig(this.name, own);
			builder.addConfig(this.syncStem, {
				extends: ConfigSet.reference(configFileName(this.name)),
				...(syncDir && { syncDir }),
			});
		} else {
			builder.addConfig(this.name, {
				...own,
				...(syncDir && { syncDir }),
			});
		}
	}

	/** The commands that build and serve the set: a compiler's own, watching and serving the configs, then what Darklua needs to read `processed` into `syncDir`. */
	planSteps(
		builder: InitPlanBuilder,
		directory: InitDirectory,
		{
			compileCommand,
			processed,
			syncDir,
		}: {
			readonly compileCommand?: string;
			readonly processed: readonly string[];
			readonly syncDir?: string;
		}
	): void {
		const { darklua } = directory.workspace;
		builder.addRun(
			...(compileCommand ? [compileCommand] : []),
			// Darklua reads the source-rooted project, so both are kept current.
			ConfigSet.watchCommand(this.stems),
			ConfigSet.serveCommand(this.servedStem)
		);
		if (this.darklua && syncDir) {
			builder.addDarkluaCommands(
				...darklua.processCommands(directory.path, processed, syncDir)
			);
		}
		if (this.sourced) {
			builder.addSourcemapSteps(defaultOutFileName(this.name), darklua);
		}
	}

	/** The files a place named like this writes, plus its project file, which mustn't exist either. */
	get placeFiles(): string[] {
		return [
			configFileName(this.name),
			...(this.syncFile ? [this.syncFile] : []),
			...(this.language.compiler?.placeFileNames(this.name) ?? []),
			defaultOutFileName(this.name),
		];
	}
}
