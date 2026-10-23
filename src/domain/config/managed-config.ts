import { PathSet } from "../../base/path.js";
import { safeStringify } from "../../base/json.js";
import { ConfigLoader, LoadedConfig } from "./config-loader.js";
import { ConfigEntry, validFile } from "./config-service.js";

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
			? ManagedConfig.identityOf(loaded)
			: undefined;
	}

	static async open(
		file: string,
		loader: ConfigLoader
	): Promise<ManagedConfig> {
		return new ManagedConfig(file, loader, await loader.load(file));
	}

	private static identityOf(loaded: LoadedConfig): string | undefined {
		return safeStringify(loaded.value);
	}

	get entry(): ConfigEntry {
		return this._entry;
	}

	get files(): readonly string[] {
		return this._files;
	}

	reads(changed: PathSet): boolean {
		return this._files.some((file) => changed.has(file));
	}

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
			lastValid: this._entry && validFile(this._entry),
		};
	}

	private async load(): Promise<void> {
		const loaded = await this.loader.load(this.file);
		this._entry = this.entryOf(loaded);
		this._files = loaded.files;
		if (loaded.resolved.isOk())
			this.text = ManagedConfig.identityOf(loaded);
	}

	/** Whether the valid version changed. A reload that loads equal keeps the previous entry. */
	async reload(): Promise<boolean> {
		const before = { text: this.text, valid: validFile(this.entry) };
		await this.load();
		const valid = validFile(this.entry);
		if (this.text === undefined || !valid) return false;

		if (before.text !== this.text) return true;
		if (this._entry?.status === "valid" && before.valid)
			this._entry = { ...this._entry, ...before.valid };
		return false;
	}
}
