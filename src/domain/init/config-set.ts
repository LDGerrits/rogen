import path from "path";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	DEFAULT_CONFIG_STEM,
	RogenConfig,
	configFileName,
	defaultOutFileName,
} from "../config/config.js";
import { SyncServer } from "../serve/serve.js";
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
		/** Darklua when it processes the code, else `undefined`. */
		readonly darklua: Darklua | undefined,
		/** The folder its files go in, relative to the directory: a place's own, else the directory itself. */
		readonly dir = "."
	) {}

	/** The stem of the synced config beside `name`'s source-rooted one. */
	static syncStemOf(name: string): string {
		return name === DEFAULT_CONFIG_STEM ? "sync" : `${name}-sync`;
	}

	/** Project files in `directory` that no config beside them writes, other than the template. */
	static handWrittenProjectFiles(directory: InitDirectory): string[] {
		return directory.projectFilesWithoutConfig.filter(
			(file) =>
				file !== TEMPLATE_FILE && !file.endsWith(`.${TEMPLATE_FILE}`)
		);
	}

	/** `extends` as init writes it: relative, and explicitly so. */
	static reference(file: string): string {
		return file.startsWith("../") ? file : `./${file}`;
	}

	/** Where a place named `name` keeps its files: beside the shared folder when that sits in a folder of its own, as `places/shared` does, else in `places`. */
	static placeFolderOf(
		name: string,
		sharedRootDirs: readonly string[] = []
	): string {
		const [rootDir] = sharedRootDirs;
		const shared = rootDir?.replace(/\/src$/, "");
		const container = shared && path.posix.dirname(shared);
		return `${container && container !== "." ? container : PLACES_DIR}/${name}`;
	}

	/** Where a new project's place named `name` keeps its files: the folder `init` found it in, else beside the shared folder. */
	static placeFolderIn(
		directory: InitDirectory,
		name: string,
		sharedRootDirs: readonly string[]
	): string {
		return directory.workspace.places.includes(name)
			? ConfigSet.placeFolderOf(name)
			: ConfigSet.placeFolderOf(name, sharedRootDirs);
	}

	/** A place's first port: the first above Rojo's default that `taken` lacks, so every place serves at once. */
	static freePort(taken: readonly number[]): number {
		let port = SyncServer.ROJO.defaultPort + 1;
		while (taken.includes(port)) port++;
		return port;
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
		const [name = DEFAULT_CONFIG_STEM] = names;
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
		return this.sourced
			? this.fileIn(configFileName(this.syncStem))
			: undefined;
	}

	/** The stems of its configs, in the order they're written. */
	get stems(): string[] {
		return this.sourced ? [this.name, this.syncStem] : [this.name];
	}

	get configFiles(): string[] {
		return this.stems.map((stem) => this.fileIn(configFileName(stem)));
	}

	get outputFiles(): string[] {
		return this.stems.map((stem) => this.fileIn(defaultOutFileName(stem)));
	}

	/** The project file the named config writes. */
	get projectFile(): string {
		return this.fileIn(defaultOutFileName(this.name));
	}

	/** `file`, named in `dir`, relative to the directory. */
	fileIn(file: string): string {
		return this.dir === "." ? file : `${this.dir}/${file}`;
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
			builder.addConfig(this.name, own, this.dir);
			builder.addConfig(
				this.syncStem,
				{
					extends: ConfigSet.reference(configFileName(this.name)),
					...(syncDir && { syncDir }),
				},
				this.dir
			);
		} else {
			builder.addConfig(
				this.name,
				{ ...own, ...(syncDir && { syncDir }) },
				this.dir
			);
		}
	}

	/** The commands that build and serve the set: a compiler's own, serving the configs, then what Darklua needs to read `processed` into `syncDir`. */
	planSteps(
		builder: InitPlanBuilder,
		directory: InitDirectory,
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
			/** Whether to keep the root sourcemap current from this set's project file; a set below the root always keeps its own. */
			readonly sourcemap?: boolean;
		}
	): void {
		const { darklua } = this;
		builder.addRun(
			...(compileCommand ? [compileCommand] : []),
			serveCommand
		);
		const config = this.darkluaConfigIn(directory);
		if (darklua && syncDir) {
			builder.addDarkluaCommands(
				...darklua.processCommands(
					directory.path,
					processed,
					syncDir,
					config
				)
			);
		}
		if (darklua && this.sourced && (sourcemap || config)) {
			builder.addSourcemapSteps(this.projectFile, darklua);
		}
		if (darklua && config) {
			builder.addEdit(
				darklua.placeConfigStep(
					this.dir,
					this.name,
					this.projectFile,
					directory.workspace.darkluaConfig
				)
			);
		}
	}

	/** The Darklua config a sourced set below the root processes with, beside its sourcemap. */
	private darkluaConfigIn(directory: InitDirectory): string | undefined {
		if (!this.darklua || !this.sourced || this.dir === ".")
			return undefined;
		return this.darklua.placeConfigOf(
			this.dir,
			this.name,
			directory.workspace.darkluaConfig
		);
	}

	/** The files a place named like this writes, plus its project file, which mustn't exist either. */
	get placeFiles(): string[] {
		return [
			...this.configFiles,
			...(this.language.compiler?.placeFileNames(this.name) ?? []).map(
				(file) => this.fileIn(file)
			),
			this.projectFile,
		];
	}
}
