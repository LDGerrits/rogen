import path from "path";
import { escapedGlobPrefix } from "../../base/glob.js";
import { toPosix } from "../../base/path.js";
import { ConfigFile } from "../../platform/config/config-file.js";
import {
	Config,
	ConfigModel,
	ConfigSection,
} from "../../platform/config/config-models.js";
import { DiagnosticLocation } from "../../platform/diagnostics/diagnostic.js";
import {
	PathForm,
	configDefaults,
	configLeafOnlyKeys,
	configMergePolicies,
	configPathForms,
} from "./config-schema.js";
import { fieldOf } from "./config.js";

/** Per-invocation values that sit above every layer of a config's chain. */
export interface ConfigOverrides {
	/** Resolved against the working directory. */
	readonly outFile?: string;
}

/** A config's chain merged with the defaults and the command line, with each value traceable to the file that set it. */
export class LayeredConfig {
	readonly config: Config;
	/** The chain from its root to the leaf, matching the layers of `config`. */
	readonly files: readonly ConfigFile[];
	private readonly layers: readonly ConfigModel[];

	/** `chain` is the leaf first, then each parent. */
	constructor(
		chain: readonly ConfigFile[],
		overrides: ConfigOverrides,
		cwd: string
	) {
		this.files = [...chain].reverse();
		const leaf = chain[0];
		this.layers = this.files.map((file) =>
			LayeredConfig.layerModel(file, file === leaf)
		);

		this.config = new Config(
			new ConfigModel(
				LayeredConfig.absolutize(
					configDefaults.contents,
					path.dirname(leaf.file)
				)
			),
			this.layers,
			LayeredConfig.cliModel(overrides, cwd),
			configMergePolicies
		);
	}

	get leaf(): ConfigFile {
		return this.files[this.files.length - 1];
	}

	/** Every template the chain names, the furthest first, each once at the nearest layer that names it, with where that layer did. */
	templates(): { file: string; location: DiagnosticLocation }[] {
		const named = new Map<string, DiagnosticLocation>();
		this.layers.forEach((layer, index) => {
			const file = fieldOf(layer, "template");
			if (typeof file !== "string") return;
			named.delete(file);
			named.set(file, this.positionIn(index, ["template"]));
		});
		return [...named].map(([file, location]) => ({ file, location }));
	}

	/** Where the config set `section`, or the leaf file when nothing did. */
	locate(...section: ConfigSection[]): DiagnosticLocation {
		const path = LayeredConfig.pathOf(section);
		const { source } = this.config.inspect(path);
		return source?.tier === "layer"
			? this.positionIn(source.index, path)
			: { resource: this.leaf.file };
	}

	/** Where the config wrote the entry at `index` of the merged list `field`, or the leaf file when no file did. */
	locateEntry(field: string, index: number): DiagnosticLocation {
		const entry = this.config.entries([field])[index];
		if (entry?.source.tier !== "layer") return { resource: this.leaf.file };
		return this.positionIn(entry.source.index, [
			field,
			String(entry.index),
		]);
	}

	private positionIn(
		layer: number,
		path: readonly string[]
	): DiagnosticLocation {
		const file = this.files[layer];
		return { resource: file.file, position: file.positionOf(path) };
	}

	private static pathOf(section: ConfigSection[]): string[] {
		return section.flatMap((part) =>
			typeof part === "string" ? [part] : part
		);
	}

	private static cliModel(
		overrides: ConfigOverrides,
		cwd: string
	): ConfigModel {
		const contents: Record<string, unknown> = {};
		if (overrides.outFile !== undefined)
			contents.outFile = overrides.outFile;
		return new ConfigModel(LayeredConfig.absolutize(contents, cwd));
	}

	private static layerModel(file: ConfigFile, isLeaf: boolean): ConfigModel {
		const contents = { ...file.model.contents };
		if (!isLeaf) {
			for (const key of configLeafOnlyKeys) delete contents[key];
		}
		return new ConfigModel(
			LayeredConfig.absolutize(contents, path.dirname(file.file))
		);
	}

	/** Relative paths resolve against the directory of the file that wrote them. */
	private static absolutize(
		contents: Record<string, unknown>,
		dir: string
	): Record<string, unknown> {
		const resolve = (value: unknown, form: PathForm): unknown => {
			if (form === "path")
				return typeof value === "string"
					? path.resolve(dir, value)
					: value;
			if (!Array.isArray(value)) return value;
			return form === "paths"
				? value.map((entry) => path.resolve(dir, entry))
				: value.map((glob) =>
						path.posix.join(escapedGlobPrefix(toPosix(dir)), glob)
					);
		};
		const result = { ...contents };
		for (const [key, form] of Object.entries(configPathForms))
			if (key in result) result[key] = resolve(result[key], form);
		return result;
	}
}
