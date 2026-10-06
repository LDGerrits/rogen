import { Config } from "../../platform/config/config-models.js";
import { ConfigLoader } from "./config-loader.js";
import { ConfigOverrides } from "./layered-config.js";
import { ConfigEntry, buildableConfig } from "./config-service.js";

/** One config file that loads and reloads itself, and keeps its last valid version while the file is broken. */
export class ManagedConfig {
	private _entry: ConfigEntry | undefined;
	private config: Config | undefined;
	private _files: readonly string[] = [];
	private _skippedVariants: readonly string[] | undefined;

	constructor(
		readonly file: string,
		private readonly loader: ConfigLoader,
		private readonly overrides: ConfigOverrides
	) {}

	/** The latest snapshot; `load` must have finished. */
	get entry(): ConfigEntry {
		if (!this._entry) throw new Error(`${this.file} has not been loaded.`);
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

	reads(changed: ReadonlySet<string>): boolean {
		return this._files.some((file) => changed.has(file));
	}

	async load(): Promise<void> {
		const lastValid = this._entry && buildableConfig(this._entry);
		const loaded = await this.loader.load(this.file, this.overrides);
		const fields = { file: this.file, parents: loaded.chain.slice(1) };
		this._files = loaded.files;
		this._skippedVariants = loaded.skippedVariants;

		if (loaded.resolved.isOk()) {
			this.config = loaded.config;
			this._entry = {
				...fields,
				status: "valid",
				config: loaded.resolved.value,
			};
		} else {
			this._entry = {
				...fields,
				status: "broken",
				errors: loaded.resolved.error,
				lastValid,
			};
		}
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
