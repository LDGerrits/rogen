import { PathSet } from "../../base/path.js";
import { safeStringify } from "../../base/json.js";
import { ConfigLoader, LoadedConfig } from "./config-loader.js";
import { ConfigEntry, buildableFile } from "./config-service.js";

/** One config file that loads and reloads itself, and keeps its last valid version while the file is broken. */
export class ManagedConfig {
	private _entry: ConfigEntry;
	private text: string | undefined;
	private _files: readonly string[];

	private constructor(
		readonly file: string,
		private readonly loader: ConfigLoader,
		loaded: LoadedConfig
	) {
		this._files = loaded.files;
		this._entry = this.entryOf(loaded);
		this.text = loaded.resolved.isOk()
			? ManagedConfig.textOf(loaded)
			: undefined;
	}

	/** Loads `file`. */
	static async open(
		file: string,
		loader: ConfigLoader
	): Promise<ManagedConfig> {
		return new ManagedConfig(file, loader, await loader.load(file));
	}

	/** What identifies the version of the config: its own contents and its places'. */
	private static textOf(loaded: LoadedConfig): string | undefined {
		return safeStringify([loaded.value, loaded.placeValues]);
	}

	/** The latest snapshot. */
	get entry(): ConfigEntry {
		return this._entry;
	}

	/** Every file the config reads. */
	get files(): readonly string[] {
		return this._files;
	}

	/** Whether it reads one of `changed`. */
	reads(changed: PathSet): boolean {
		return this._files.some((file) => changed.has(file));
	}

	/** The entry `loaded` makes, a broken one keeping the last valid version this config had. */
	private entryOf(loaded: LoadedConfig): ConfigEntry {
		const fields = { file: this.file };
		if (loaded.resolved.isOk())
			return {
				...fields,
				status: "valid",
				...loaded.resolved.value,
			};
		return {
			...fields,
			status: "broken",
			errors: loaded.resolved.error,
			lastValid: this._entry && buildableFile(this._entry),
		};
	}

	private async load(): Promise<void> {
		const loaded = await this.loader.load(this.file);
		this._entry = this.entryOf(loaded);
		this._files = loaded.files;
		if (loaded.resolved.isOk()) this.text = ManagedConfig.textOf(loaded);
	}

	/** Whether the reload changed the version that builds. A config that loads equal to it keeps it, so the version is its identity. */
	async reload(): Promise<boolean> {
		const before = { text: this.text, built: buildableFile(this.entry) };
		await this.load();
		const built = buildableFile(this.entry);
		if (this.text === undefined || !built) return false;

		if (before.text !== this.text) return true;
		if (this._entry?.status === "valid" && before.built)
			this._entry = { ...this._entry, ...before.built };
		return false;
	}
}
