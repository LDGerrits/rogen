import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	DEFAULT_CONFIG_STEM,
	RogenConfig,
	configFileName,
} from "../config/config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import {
	Darklua,
	DetectedWorkspace,
	Language,
} from "../toolchain/toolchain.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { TEMPLATE_FILE } from "./starter-template.js";

/** Where the configs of a set sync from: `synced` is Darklua's output, else a compiler's; `source` is what a sourced set's own config syncs, a compiler's output a place of its own. */
export interface SyncDirs {
	readonly source?: string;
	readonly synced?: string;
}

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
		if (name !== name.trim()) {
			return err(
				new UsageError(
					`"${name}" is not a valid config name: it can't start or end with a space.`
				)
			);
		}
		if (name.endsWith(".json")) {
			return err(
				new UsageError(
					`"${name}" is not a valid config name: a name ending in .json is read as a path.`
				)
			);
		}
		// eslint-disable-next-line no-control-regex
		const unfit = /[<>:"|?*\u0000-\u001f]/.exec(name);
		if (unfit) {
			return err(
				new UsageError(
					`"${name}" is not a valid config name: it can't contain ${unfit[0] < " " ? "control characters" : `"${unfit[0]}"`}.`
				)
			);
		}
		if (projectFileName(name) === TEMPLATE_FILE) {
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

	/** Whether a synced config is written beside the named one: Darklua's output is served, and the named config stays with what Darklua reads, which a sourcemap and a compiler's project file are made from. */
	get sourced(): boolean {
		return this.darklua !== undefined;
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
		return this.stems.map(projectFileName);
	}

	/** Says where variants of a script are swapped in, in the words the next steps use. */
	get variantsStep(): string {
		return `Declare variants under "variants" in ${configFileName(this.name)} to swap in files like Analytics.mock.${this.language.extension}, and turn them on in a mode or with --variant.`;
	}

	/** The stem of the config that is served: the synced one when there is one. */
	get servedStem(): string {
		return this.sourced ? this.syncStem : this.name;
	}

	/** The command that serves the set: a bare `rogen serve` picks the config no other extends, but named configs share a port, so they are named. */
	get serveCommand(): string {
		if (this.name === DEFAULT_CONFIG_STEM) return "rogen serve";
		return `rogen serve ${this.servedStem}`;
	}

	/** The command that serves the set beside configs that were here before, which a bare `rogen serve` would serve on the same port. */
	serveCommandBeside(others: boolean): string {
		return others ? `rogen serve ${this.servedStem}` : this.serveCommand;
	}

	/** Writes `own` with the `synced` dir; a sourced set keeps `own` at the `source` dir, a compiler's output or none for Luau, and a second config extending it takes the `synced` dir. */
	planConfigs(
		builder: InitPlanBuilder,
		own: RogenConfig,
		{ source, synced }: SyncDirs
	): void {
		if (this.sourced) {
			builder.addConfig(this.name, {
				...own,
				...(source && { syncDir: source }),
			});
			builder.addConfig(this.syncStem, {
				extends: ConfigSet.reference(configFileName(this.name)),
				...(synced && { syncDir: synced }),
			});
		} else {
			builder.addConfig(this.name, {
				...own,
				...(synced && { syncDir: synced }),
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
		// A compiler's output doesn't require by string, so Darklua needs no sourcemap of it.
		if (darklua && this.sourced && sourcemap && !this.language.compiler) {
			const projectFile = projectFileName(this.name);
			const command = darklua.sourcemapCommand(projectFile);
			// luau-lsp keeps the sourcemap Darklua reads current from the default project; any other needs its own watch.
			if (projectFile === projectFileName(DEFAULT_CONFIG_STEM))
				builder.addEdit(
					`Darklua reads sourcemap.json, which luau-lsp keeps current from ${projectFile}. Without luau-lsp, run: ${command}`
				);
			else builder.addRun(command);
		}
	}

	/** The configs and the project files they write, none of which may exist. */
	get writtenFiles(): string[] {
		return [...this.configFiles, ...this.outputFiles];
	}

	/** The files a place named like this writes, the compiler's own among them. */
	get placeFiles(): string[] {
		return [
			...this.configFiles,
			...(this.language.compiler?.placeFileNames(this.name) ?? []),
			...this.outputFiles,
		];
	}
}
