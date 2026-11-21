import { PathSet } from "../../base/path.js";
import { safeStringify } from "../../base/json.js";
import { ConfigVersion } from "./config-change.js";
import { ConfigLoader, LoadedConfig } from "./config-loader.js";
import { ConfigEntry, validFile } from "./config-service.js";
import { ResolvedConfigFile } from "./resolved-config.js";

interface WrittenVersion {
	readonly value: string | undefined;
	readonly text: string | undefined;
}

const sameVersion = (
	before: WrittenVersion | undefined,
	after: WrittenVersion
): boolean =>
	before !== undefined &&
	before.value === after.value &&
	before.text === after.text;

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

	async reload(): Promise<void> {
		const before = { written: this.written, valid: validFile(this._entry) };
		const loaded = await this.loader.load(this.file);
		this._entry = this.entryOf(loaded);
		this._files = loaded.files;
		const written = ManagedConfig.writtenOf(loaded);
		if (!written) return;
		this.written = written;
		if (before.valid && sameVersion(before.written, written))
			this.keepWrittenObjects(before.valid);
	}

	private keepWrittenObjects(previous: ResolvedConfigFile): void {
		this._entry = { ...this._entry, ...previous };
	}
}
