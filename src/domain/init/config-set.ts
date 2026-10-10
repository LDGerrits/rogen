import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	DEFAULT_CONFIG_STEM,
	RogenConfig,
	configFileName,
	defaultOutFileName,
} from "../config/config.js";
import {
	Darklua,
	DetectedWorkspace,
	Language,
} from "../toolchain/toolchain.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { TEMPLATE_FILE } from "./starter-template.js";

/** The names `init` writes for one config name; a Darklua repo without a compiler gets the named config, rooted at the source for luau-lsp and Darklua, and a synced one to serve. */
export class ConfigSet {
	constructor(
		readonly name: string,
		readonly language: Language,
		/** Darklua when it processes the code, else `undefined`. */
		readonly darklua: Darklua | undefined
	) {}

	/** The names `init` writes for a config called `name`, in the language and Darklua setup `workspace` uses. */
	static in(workspace: DetectedWorkspace, name: string): ConfigSet {
		return new ConfigSet(
			name,
			workspace.language,
			workspace.detectedDarklua
		);
	}

	/** The stem of the synced config beside `name`'s source-rooted one. */
	static syncStemOf(name: string): string {
		return name === DEFAULT_CONFIG_STEM ? "sync" : `${name}-sync`;
	}

	/** `extends` as init writes it: relative, and explicitly so. */
	static reference(file: string): string {
		return `./${file}`;
	}

	/** The glob that matches a language's spec files. */
	static specGlobOf(language: Language): string {
		return `**/*.spec.${language.extension}`;
	}

	/** Says where variants of a script are swapped in, in the words the next steps use. */
	static variantsStep(language: Language, configFile: string): string {
		return `Declare variants under "variants" in ${configFile} to swap in files like Analytics.mock.${language.extension}, and turn them on in a mode or with --variant.`;
	}

	/** `names` are the positionals after `init`. */
	static parseName(names: readonly string[]): Result<string, Error> {
		if (names.length > 1) {
			return err(new UsageError("init takes at most one config name."));
		}
		return ConfigSet.checkName(names[0] ?? DEFAULT_CONFIG_STEM);
	}

	/** `name` as a config name `init` can write. */
	static checkName(name: string): Result<string, Error> {
		if (name.trim() === "") {
			return err(new UsageError("A config name can't be empty."));
		}
		if (name === "." || name === ".." || /[\\/]/.test(name)) {
			return err(
				new UsageError(
					`"${name}" is not a valid config name: it can't contain path separators.`
				)
			);
		}
		if (defaultOutFileName(name) === TEMPLATE_FILE) {
			return err(
				new UsageError(
					`"${name}" is not a valid config name: it would write over ${TEMPLATE_FILE}.`
				)
			);
		}
		return ok(name);
	}

	/** The sync dir written for a config: Darklua's output, else the compiler's, else none. */
	get syncDir(): string | undefined {
		return this.darklua
			? this.darklua.defaultSyncDir
			: this.language.compiler?.outDir;
	}

	/** Whether a synced config is written beside the named one. */
	get sourced(): boolean {
		return (
			this.darklua !== undefined && this.language.compiler === undefined
		);
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

	/** The command that serves the set: a bare `rogen serve` picks the config no other extends, but named configs share a port, so they are named. */
	get serveCommand(): string {
		if (this.name === DEFAULT_CONFIG_STEM) return "rogen serve";
		return `rogen serve ${this.sourced ? this.syncStem : this.name}`;
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

	/** The commands that build and serve the set: a compiler's own, serving the configs, then what Darklua needs to read `processed` into `syncDir`. */
	planSteps(
		builder: InitPlanBuilder,
		directory: string,
		{
			compileCommand,
			serveCommand = this.serveCommand,
			processed,
			syncDir,
			sourcemap = true,
		}: {
			readonly compileCommand?: string;
			readonly serveCommand?: string;
			readonly processed: readonly string[];
			readonly syncDir?: string;
			/** Whether to keep the sourcemap Darklua reads current from this set's project file. */
			readonly sourcemap?: boolean;
		}
	): void {
		const { darklua } = this;
		builder.addRun(
			...(compileCommand ? [compileCommand] : []),
			serveCommand
		);
		if (darklua && syncDir) {
			builder.addDarkluaCommands(
				...darklua.processCommands(directory, processed, syncDir)
			);
		}
		if (darklua && this.sourced && sourcemap) {
			const projectFile = defaultOutFileName(this.name);
			const command = darklua.sourcemapCommand(projectFile);
			// luau-lsp keeps the sourcemap Darklua reads current from the default project; any other needs its own watch.
			if (projectFile === defaultOutFileName(DEFAULT_CONFIG_STEM))
				builder.addEdit(
					`Darklua reads sourcemap.json, which luau-lsp keeps current from ${projectFile}. Without luau-lsp, run: ${command}`
				);
			else builder.addRun(command);
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
