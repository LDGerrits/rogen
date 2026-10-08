import path from "path";
import { toPosix } from "../../base/path.js";
import { ConfigFile } from "../../platform/config/config-file.js";
import {
	Config,
	ConfigModel,
	ConfigSection,
} from "../../platform/config/config-models.js";
import { DiagnosticLocation } from "../../platform/diagnostics/diagnostic.js";
import { configDefaults, configMergePolicies } from "./config-schema.js";

/** The fields that hold a path, which resolve against the file that sets them. */
const PATH_FIELDS = ["template", "syncDir", "outFile"] as const;

/** Per-invocation values that sit above every layer of a config's chain. */
export interface ConfigOverrides {
	/** Resolved against the working directory. */
	readonly outFile?: string;
	/** Variant name to whether it is on. */
	readonly variants: Readonly<Record<string, boolean>>;
}

/** A config's chain merged with the defaults and the command line, with each value traceable to the file that set it. */
export class LayeredConfig {
	private static readonly LEAF_ONLY_KEYS = ["extends", "$schema", "outFile"];

	readonly config: Config;
	/** The chain from its root to the leaf, matching the layers of `config`. */
	readonly files: readonly ConfigFile[];
	/** The variants the CLI named that no layer declares, so they were left out of `config`. */
	readonly skippedVariants: readonly string[];

	/** `chain` is the leaf first, then each parent. */
	constructor(
		chain: readonly ConfigFile[],
		overrides: ConfigOverrides,
		cwd: string
	) {
		this.files = [...chain].reverse();
		const leaf = chain[0];
		const layers = this.files.map((file) =>
			LayeredConfig.layerModel(file, file === leaf)
		);

		const declared = new Set(
			layers.flatMap((layer) =>
				Object.keys(
					layer.getValue<Record<string, boolean>>("variants") ?? {}
				)
			)
		);
		const variantNames = Object.keys(overrides.variants);
		this.skippedVariants = variantNames.filter(
			(variant) => !declared.has(variant)
		);
		this.config = new Config(
			new ConfigModel(
				LayeredConfig.absolutize(
					configDefaults.contents,
					path.dirname(leaf.file)
				)
			),
			layers,
			LayeredConfig.cliModel(
				overrides,
				variantNames.filter((variant) => declared.has(variant)),
				cwd
			),
			configMergePolicies
		);
	}

	get leaf(): ConfigFile {
		return this.files[this.files.length - 1];
	}

	/** Where the config set `section`, or the leaf file when nothing did. */
	locate(...section: ConfigSection[]): DiagnosticLocation {
		const path = section.flatMap((part) =>
			typeof part === "string" ? [part] : part
		);
		const { source } = this.config.inspect(path);
		if (source?.tier !== "layer") return { resource: this.leaf.file };
		const file = this.files[source.index];
		return { resource: file.file, position: file.positionOf(path) };
	}

	/** Where the config wrote the entry at `index` of the merged list `field`, or the leaf file when no file did. */
	locateEntry(field: string, index: number): DiagnosticLocation {
		const entry = this.config.entries([field])[index];
		if (entry?.source.tier !== "layer") return { resource: this.leaf.file };
		const file = this.files[entry.source.index];
		return {
			resource: file.file,
			position: file.positionOf([field, String(entry.index)]),
		};
	}

	private static cliModel(
		overrides: ConfigOverrides,
		declaredVariants: readonly string[],
		cwd: string
	): ConfigModel {
		const contents: Record<string, unknown> = {};
		if (overrides.outFile !== undefined)
			contents.outFile = overrides.outFile;
		if (declaredVariants.length > 0) {
			contents.variants = Object.fromEntries(
				declaredVariants.map((variant) => [
					variant,
					overrides.variants[variant],
				])
			);
		}
		return new ConfigModel(LayeredConfig.absolutize(contents, cwd));
	}

	private static layerModel(file: ConfigFile, isLeaf: boolean): ConfigModel {
		const contents = { ...file.model.contents };
		if (!isLeaf) {
			for (const key of LayeredConfig.LEAF_ONLY_KEYS)
				delete contents[key];
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
		const absolute = (value: string) => path.resolve(dir, value);
		const result = { ...contents };

		for (const key of PATH_FIELDS) {
			const value = result[key];
			if (typeof value === "string") result[key] = absolute(value);
		}
		if (Array.isArray(result.rootDirs)) {
			result.rootDirs = result.rootDirs.map(absolute);
		}
		if (Array.isArray(result.exclude)) {
			result.exclude = result.exclude.map((glob: string) =>
				path.posix.join(toPosix(dir), glob)
			);
		}
		return result;
	}
}
