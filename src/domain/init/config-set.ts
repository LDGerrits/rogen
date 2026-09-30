import { Result, err, ok } from "../../base/result.js";
import { DEFAULT_CONFIG_STEM, configFileName } from "../config/config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { Darklua, Language, PLACES_DIR } from "../toolchain/toolchain.js";
import { TEMPLATE_FILE } from "./init-directory.js";

/** The names `init` writes for one config name; a Darklua repo without a compiler gets a source config and a synced one. */
export class ConfigSet {
	/** The config a project starts with. */
	static readonly DEFAULT_FILE = configFileName(DEFAULT_CONFIG_STEM);

	constructor(
		readonly name: string,
		readonly language: Language,
		readonly darklua: boolean
	) {}

	/** The stem of the source-rooted config beside `name`'s synced one. */
	static sourceStemOf(name: string): string {
		return name === DEFAULT_CONFIG_STEM ? "source" : `${name}-source`;
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
		return [configFileName(name), projectFileName(name)];
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
		if (projectFileName(name) === TEMPLATE_FILE) {
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

	get sourced(): boolean {
		return this.darklua && this.language.compiler === undefined;
	}

	get sourceStem(): string {
		return ConfigSet.sourceStemOf(this.name);
	}

	/** The source config's file, when there is one. */
	get sourceFile(): string | undefined {
		return this.sourced ? configFileName(this.sourceStem) : undefined;
	}

	/** The stems of its configs, the synced one first. */
	get stems(): string[] {
		return this.sourced ? [this.name, this.sourceStem] : [this.name];
	}

	/** Every config file, in the order they're written. */
	get configFiles(): string[] {
		return this.stems.reverse().map(configFileName);
	}

	/** The project files the configs write, the synced one first. */
	get outputFiles(): string[] {
		return this.stems.map(projectFileName);
	}

	/** The config where routes and tags are edited: the one holding the root dirs. */
	get editedFile(): string {
		return configFileName(this.stems[this.stems.length - 1]);
	}

	/** The files a place named like this writes, plus its project file, which mustn't exist either. */
	get placeFiles(): string[] {
		return [
			configFileName(this.name),
			...(this.sourceFile ? [this.sourceFile] : []),
			...(this.language.compiler?.placeFileNames(this.name) ?? []),
			projectFileName(this.name),
		];
	}
}
