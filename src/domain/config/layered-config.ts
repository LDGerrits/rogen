import path from "path";
import { isObject } from "../../base/objects.js";
import { toPosix } from "../../base/path.js";
import { ConfigFile } from "../../platform/config/config-file.js";
import {
	Config,
	ConfigModel,
	ConfigSection,
} from "../../platform/config/config-models.js";
import { DiagnosticLocation } from "../../platform/diagnostics/diagnostic.js";
import { configDefaults, configMergePolicies } from "./config-schema.js";
import { VariantSwitch, switchVariants } from "./variant-switch.js";

/** The fields that hold a path, which resolve against the file that sets them. */
const PATH_FIELDS = ["template", "syncDir", "outFile"] as const;

/** Per-invocation values that sit above every layer of a config's chain. */
export interface ConfigOverrides {
	/** Resolved against the working directory. */
	readonly outFile?: string;
	/** The mode to build in, in place of the config's own choice. */
	readonly mode?: string;
	/** Variant name to whether it is on. */
	readonly variants: Readonly<Record<string, boolean>>;
}

/** The mode a config builds in, and how it was chosen. */
export interface ModeChoice {
	/** What was asked for or written; `undefined` when nothing names one. */
	readonly name: string | undefined;
	readonly source: "cli" | "config" | undefined;
}

/** A config's chain merged with the defaults, its active mode and the command line, with each value traceable to the file that set it. */
export class LayeredConfig {
	private static readonly LEAF_ONLY_KEYS = ["extends", "$schema", "outFile"];

	/** The config in the active mode. */
	readonly config: Config;
	/** The chain from its root to the leaf, matching the layers of `config`. */
	readonly files: readonly ConfigFile[];
	/** The variants the CLI named that no layer declares, so they were left out. */
	readonly skippedVariants: readonly string[];
	/** Every variant the chain declares, in order. */
	readonly variants: readonly string[];
	/** Each declared variant's switch in the active mode, with the command line applied. */
	readonly switches: ReadonlyMap<string, VariantSwitch>;
	/** Every mode the chain declares, in declaration order. */
	readonly modes: readonly string[];
	readonly modeChoice: ModeChoice;
	/** The active mode, when the choice names one the chain declares. */
	readonly mode: string | undefined;
	private readonly chain: Config;
	private readonly cliVariants: Readonly<Record<string, boolean>>;
	private readonly defaults: ConfigModel;
	private readonly layers: readonly ConfigModel[];
	private readonly cli: ConfigModel;

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

		this.defaults = new ConfigModel(
			LayeredConfig.absolutize(
				configDefaults.contents,
				path.dirname(leaf.file)
			)
		);
		this.cli = LayeredConfig.cliModel(overrides, cwd);
		this.chain = new Config(
			this.defaults,
			this.layers,
			new ConfigModel(),
			configMergePolicies
		);

		this.variants = [
			...new Set(
				this.chain.entries<string>("variants").map(({ value }) => value)
			),
		];
		const declared = new Set(this.variants);
		const named = Object.keys(overrides.variants);
		this.skippedVariants = named.filter((name) => !declared.has(name));
		this.cliVariants = Object.fromEntries(
			named
				.filter((name) => declared.has(name))
				.map((name) => [name, overrides.variants[name]])
		);

		this.modes = Object.keys(
			this.chain.getValue<Record<string, unknown>>("modes") ?? {}
		);
		const written = this.chain.getValue<string | undefined>("mode");
		this.modeChoice = {
			name: overrides.mode ?? written,
			source:
				overrides.mode !== undefined
					? "cli"
					: written !== undefined
						? "config"
						: undefined,
		};
		this.mode =
			this.modeChoice.name !== undefined &&
			this.modes.includes(this.modeChoice.name)
				? this.modeChoice.name
				: undefined;
		this.switches = this.switchesIn(this.mode, this.cliVariants);
		this.config = this.configIn(this.mode);
	}

	get leaf(): ConfigFile {
		return this.files[this.files.length - 1];
	}

	/** The variants `mode` turns on, as the chain writes them, in the order written. */
	modeVariants(mode: string): string[] {
		return this.chain
			.entries<string>(["modes", mode, "variants"])
			.map(({ value }) => value);
	}

	/** Each declared variant's switch in `mode`, with `cli` the command line's say. */
	switchesIn(
		mode: string | undefined,
		cli: Readonly<Record<string, boolean>> = {}
	): ReadonlyMap<string, VariantSwitch> {
		return switchVariants(
			this.variants,
			mode === undefined ? [] : this.modeVariants(mode),
			cli
		);
	}

	/** The config with `mode` on top of its chain; the chain alone when `mode` is `undefined`. */
	configIn(mode: string | undefined): Config {
		return new Config(
			this.defaults,
			mode === undefined
				? this.layers
				: [...this.layers, this.modeLayer(mode)],
			this.cli,
			configMergePolicies
		);
	}

	/** Where the config set `section`, or the leaf file when nothing did. */
	locate(...section: ConfigSection[]): DiagnosticLocation {
		const path = LayeredConfig.pathOf(section);
		const { source } = this.config.inspect(path);
		if (source?.tier !== "layer") return { resource: this.leaf.file };
		if (source.index === this.files.length && this.mode !== undefined)
			return this.locateIn(this.chain, ["modes", this.mode, ...path]);
		return this.locateIn(this.config, path);
	}

	/** Where the chain declared the mode `name`, or the field of it that `section` names. */
	locateMode(name: string, ...section: ConfigSection[]): DiagnosticLocation {
		return this.locateIn(this.chain, [
			"modes",
			name,
			...LayeredConfig.pathOf(section),
		]);
	}

	/** Where the config wrote the entry at `index` of the merged list `field`, or the leaf file when no file did. */
	locateEntry(field: string, index: number): DiagnosticLocation {
		const entry = this.config.entries([field])[index];
		if (entry?.source.tier !== "layer") return { resource: this.leaf.file };
		if (
			entry.source.index === this.files.length &&
			this.mode !== undefined
		) {
			const inMode = ["modes", this.mode, field];
			const written = this.chain.entries(inMode)[entry.index];
			return written?.source.tier === "layer"
				? this.positionIn(written.source.index, [
						...inMode,
						String(written.index),
					])
				: { resource: this.leaf.file };
		}
		return this.positionIn(entry.source.index, [
			field,
			String(entry.index),
		]);
	}

	/** Where the chain wrote the entry at `index` of the merged list `field` of mode `mode`. */
	locateModeEntry(
		mode: string,
		field: string,
		index: number
	): DiagnosticLocation {
		const path = ["modes", mode, field];
		const entry = this.chain.entries(path)[index];
		return entry?.source.tier === "layer"
			? this.positionIn(entry.source.index, [
					...path,
					String(entry.index),
				])
			: { resource: this.leaf.file };
	}

	private locateIn(
		config: Config,
		path: readonly string[]
	): DiagnosticLocation {
		const { source } = config.inspect([...path]);
		return source?.tier === "layer"
			? this.positionIn(source.index, path)
			: { resource: this.leaf.file };
	}

	private positionIn(
		layer: number,
		path: readonly string[]
	): DiagnosticLocation {
		const file = this.files[layer];
		return { resource: file.file, position: file.positionOf(path) };
	}

	private modeLayer(mode: string): ConfigModel {
		const exclude = this.chain.getValue<unknown>([
			"modes",
			mode,
			"exclude",
		]);
		return new ConfigModel(exclude === undefined ? {} : { exclude });
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
		const globs = (list: string[]) =>
			list.map((glob) => path.posix.join(toPosix(dir), glob));
		if (Array.isArray(result.exclude)) {
			result.exclude = globs(result.exclude);
		}
		if (isObject(result.modes)) {
			result.modes = Object.fromEntries(
				Object.entries(result.modes).map(([name, body]) => [
					name,
					isObject(body) && Array.isArray(body.exclude)
						? { ...body, exclude: globs(body.exclude) }
						: body,
				])
			);
		}
		return result;
	}
}
