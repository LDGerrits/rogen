import { PathSet } from "../../base/path.js";
import { safeStringify } from "../../base/json.js";
import { ConfigVersion } from "./config-change.js";
import { ConfigLoader, LoadedConfig } from "./config-loader.js";
import { ConfigEntry, validFile } from "./config-service.js";

/** What a valid load is told apart by: the value decides what is written, the text where its warnings point. */
interface WrittenVersion {
	readonly value: string | undefined;
	readonly text: string | undefined;
}

/** One config file that loads and reloads itself, and keeps its last valid version while the file is broken. */
export class ManagedConfig {
	private _entry: ConfigEntry;
	private written: WrittenVersion | undefined;
	private _files: readonly string[];

	private constructor(
		readonly file: string,
		private readonly loader: ConfigLoader,
		loaded: LoadedConfig
	) {
		this._files = loaded.files;
		this._entry = this.entryOf(loaded);
		this.written = ManagedConfig.writtenOf(loaded);
	}

	static async open(
		file: string,
		loader: ConfigLoader
	): Promise<ManagedConfig> {
		return new ManagedConfig(file, loader, await loader.load(file));
	}

	private static writtenOf(loaded: LoadedConfig): WrittenVersion | undefined {
		return loaded.resolved.isOk()
			? { value: safeStringify(loaded.value), text: loaded.text }
			: undefined;
	}

	get entry(): ConfigEntry {
		return this._entry;
	}

	get files(): readonly string[] {
		return this._files;
	}

	get version(): ConfigVersion {
		return { entry: this._entry, written: this.written?.value };
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
			...(loaded.sourcePaths && { sourcePaths: loaded.sourcePaths }),
		};
	}

	/** A reload of the same text keeps the previous valid version, so what was written stays the same object. */
	async reload(): Promise<void> {
		const before = { written: this.written, valid: validFile(this._entry) };
		const loaded = await this.loader.load(this.file);
		this._entry = this.entryOf(loaded);
		this._files = loaded.files;
		const written = ManagedConfig.writtenOf(loaded);
		if (!written) return;
		this.written = written;
		if (
			before.valid &&
			before.written &&
			before.written.value === written.value &&
			before.written.text === written.text
		)
			this._entry = { ...this._entry, ...before.valid };
	}
}
