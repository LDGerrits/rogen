import { PathSet } from "../../base/path.js";
import { Config } from "../../platform/config/config-models.js";
import { ConfigLoader, LoadedConfig } from "./config-loader.js";
import { ConfigOverrides } from "./layered-config.js";
import { ConfigEntry, buildableConfig } from "./config-service.js";

/** One config file that loads and reloads itself, and keeps its last valid version while the file is broken. */
export class ManagedConfig {
	private _entry: ConfigEntry;
	private config: Config | undefined;
	private _files: readonly string[];
	private _skippedVariants: readonly string[] | undefined;
	private _modes: readonly string[] | undefined;

	/** Loads `file` with `overrides`. */
	static async open(
		file: string,
		loader: ConfigLoader,
		overrides: ConfigOverrides
	): Promise<ManagedConfig> {
		return new ManagedConfig(
			file,
			loader,
			overrides,
			await loader.load(file, overrides)
		);
	}

	private constructor(
		readonly file: string,
		private readonly loader: ConfigLoader,
		private readonly overrides: ConfigOverrides,
		loaded: LoadedConfig
	) {
		this._files = loaded.files;
		this._entry = this.entryOf(loaded);
		this.config = loaded.config;
		this._skippedVariants = loaded.skippedVariants;
		this._modes = loaded.modes;
	}

	/** The latest snapshot. */
	get entry(): ConfigEntry {
		return this._entry;
	}

	/** Every file the config reads: its chain and its template. */
	get files(): readonly string[] {
		return this._files;
	}

	/** The CLI variants this config does not declare; `undefined` when its chain could not be read. */
	get skippedVariants(): readonly string[] | undefined {
		return this._skippedVariants;
	}

	/** The modes the config declares; `undefined` when its chain could not be read. */
	get modes(): readonly string[] | undefined {
		return this._modes;
	}

	/** Whether it reads one of `changed`. */
	reads(changed: PathSet): boolean {
		return this._files.some((file) => changed.has(file));
	}

	/** The entry `loaded` makes, a broken one keeping the last valid version this config had. */
	private entryOf(loaded: LoadedConfig): ConfigEntry {
		const fields = { file: this.file, parents: loaded.chain.slice(1) };
		if (loaded.resolved.isOk())
			return {
				...fields,
				status: "valid",
				config: loaded.resolved.value,
			};
		return {
			...fields,
			status: "broken",
			errors: loaded.resolved.error,
			lastValid: this._entry && buildableConfig(this._entry),
		};
	}

	private async load(): Promise<void> {
		const loaded = await this.loader.load(this.file, this.overrides);
		this._entry = this.entryOf(loaded);
		this._files = loaded.files;
		this._skippedVariants = loaded.skippedVariants;
		this._modes = loaded.modes;
		if (loaded.resolved.isOk()) this.config = loaded.config;
	}

	/** Whether the reload changed the version that builds. A config that loads equal to it keeps it, so the version is its identity. */
	async reload(): Promise<boolean> {
		const before = {
			config: this.config,
			built: buildableConfig(this.entry),
		};
		await this.load();
		const built = buildableConfig(this.entry);
		if (!this.config || !built) return false;

		const template = before.built?.template;
		const same =
			before.config !== undefined &&
			before.config.equals(this.config) &&
			(template
				? template.equals(built.template)
				: built.template === undefined);
		if (!same) return true;
		if (this._entry?.status === "valid" && before.built)
			this._entry = { ...this._entry, config: before.built };
		return false;
	}
}
