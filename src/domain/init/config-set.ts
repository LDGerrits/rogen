import { DEFAULT_CONFIG_STEM, configFileName } from "../config/config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { Language } from "../toolchain/toolchain.js";

/** The stem of the source-rooted config beside `name`'s synced one. */
export const sourceStemOf = (name: string): string =>
	name === DEFAULT_CONFIG_STEM ? "source" : `${name}-source`;

/**
 * The configs `init` writes for one name. A processor that reads the root
 * dirs themselves, rather than a compiler's output, resolves requires from a
 * source-rooted project, so its name gets a pair: a source config rooted at
 * the root dirs, and the synced one extending it. Every other name gets one.
 */
export class ConfigSet {
	constructor(
		readonly name: string,
		readonly language: Language,
		readonly darklua: boolean
	) {}

	get sourced(): boolean {
		return this.darklua && this.language.compiler === undefined;
	}

	get sourceStem(): string {
		return sourceStemOf(this.name);
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
