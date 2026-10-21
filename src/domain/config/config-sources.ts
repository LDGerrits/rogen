import path from "path";
import { mergeByKey } from "../../base/objects.js";
import { ConfigFile } from "../../platform/config/config-file.js";
import { ConfigModel } from "../../platform/config/config-models.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { PLACE_OWN_KEYS, ROOT_ONLY_KEYS } from "./config.js";
import { PathRebaser } from "./path-rebaser.js";

interface InheritedSource {
	readonly dir: string;
	readonly sourcePaths?: readonly string[];
	/** Whether the file's `syncRules` are the ones it takes from there, so their patterns are relative to `dir`. */
	readonly syncRules: boolean;
}

/** The values of one config file, and where in the file each came from. */
export interface ConfigSource extends ConfigFile {
	readonly inherited?: InheritedSource;
}

/** The listing config's source, which a place builds on. */
export interface PlaceBase {
	readonly dir: string;
	readonly source: ConfigSource;
}

interface ReadSource {
	readonly source: ConfigSource;
	readonly errors: readonly Diagnostic[];
}

/** Reads a config's values; a place applies them on what it takes from `base`. */
export class ConfigSourceReader {
	private readonly dir: string;
	private readonly description: Record<string, unknown>;

	constructor(
		private readonly config: ConfigFile,
		private readonly base?: PlaceBase
	) {
		this.dir = path.dirname(config.file);
		this.description = Object.fromEntries(
			Object.entries(config.model.contents).filter(
				([key]) => key !== "$schema" && !ROOT_ONLY_KEYS.includes(key)
			)
		);
	}

	read(): ReadSource {
		const { config, base } = this;
		const errors = this.placeErrors();
		if (!base) return { source: config, errors };
		return {
			source: {
				...config,
				model: new ConfigModel(this.startingValues(base)),
				inherited: {
					dir: base.dir,
					sourcePaths:
						base.source.model.getValue<string[]>("sourcePaths"),
					syncRules: this.description.syncRules === undefined,
				},
			},
			errors,
		};
	}

	private placeErrors(): Diagnostic[] {
		const { config, base } = this;
		return base && config.model.keys.includes("placePaths")
			? [
					errorDiagnostic(
						"config.placeListsPlaces",
						{
							resource: config.file,
							position: config.positionOfKey("placePaths"),
						},
						'a place can\'t list places: "placePaths" belongs to the config that lists this folder. Remove it.'
					),
				]
			: [];
	}

	private startingValues(base: PlaceBase): Record<string, unknown> {
		const inherited = Object.fromEntries(
			Object.entries(
				PathRebaser.values(
					base.source.model.contents,
					base.dir,
					this.dir
				)
			).filter(
				([key]) =>
					key !== "$schema" &&
					!PLACE_OWN_KEYS.includes(key) &&
					!ROOT_ONLY_KEYS.includes(key)
			)
		);
		return mergeByKey(inherited, this.description);
	}
}
