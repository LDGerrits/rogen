import { Result, err, ok } from "../../base/result.js";
import {
	DEFAULT_CONFIG_STEM,
	configFileName,
	defaultOutFileName,
} from "../config/config.js";
import { Darklua, Language, PLACES_DIR } from "../toolchain/toolchain.js";
import { TEMPLATE_FILE } from "./init-directory.js";

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
