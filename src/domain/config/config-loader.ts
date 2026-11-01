import { Disposable, toDisposable } from "../../base/disposable.js";
import path from "path";
import { Result, err, tryWithAsync } from "../../base/result.js";
import { ConfigFileReader } from "../../platform/config/config-file.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { isConfigFileName, isProjectFileConfig } from "./config.js";
import { FolderConfig, folderClashes } from "./folder-clashes.js";
import { configStructure } from "./config-structure.js";
import { ConfigFileCheck } from "./config-service.js";
import { ResolvedConfigFile } from "./resolved-config.js";
import { ConfigValidator } from "./config-validator.js";

/** One read of one config, with what a reload compares against. */
export interface LoadedConfig {
	readonly files: readonly string[];
	readonly value?: Readonly<Record<string, unknown>>;
	readonly resolved: Result<ResolvedConfigFile, Diagnostic[]>;
	/** The source paths of a config that only a copy beside it breaks. */
	readonly sourcePaths?: readonly string[];
}

export class ConfigLoader {
	private readonly reader: ConfigFileReader;

	constructor(
		private readonly fileSystemService: FileReader,
		private readonly fileChecks = new Set<ConfigFileCheck>()
	) {
		this.reader = new ConfigFileReader(fileSystemService, configStructure);
	}

	/** A loader that reads through `reader`, with the same checks. */
	over(reader: FileReader): ConfigLoader {
		return new ConfigLoader(reader, this.fileChecks);
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		this.fileChecks.add(check);
		return toDisposable(() => this.fileChecks.delete(check));
	}

	/** Never throws for a problem the user can cause. A config that copies another of its folder fails, and is reloaded when that one changes. */
	async load(file: string): Promise<LoadedConfig> {
		const loaded = await this.loadFile(file);
		if (loaded.resolved.isErr() || isProjectFileConfig(file)) return loaded;
		const siblings = await this.siblingsOf(file);
		const clashes = folderClashes(
			{ config: loaded.resolved.value.config, value: loaded.value },
			siblings
		);
		const files = [...loaded.files, ...siblings.map((s) => s.config.file)];
		return clashes.length > 0
			? {
					files,
					value: loaded.value,
					resolved: err(clashes),
					sourcePaths: loaded.resolved.value.config.sourcePaths,
				}
			: { ...loaded, files };
	}

	/** The configs beside `file` that load. */
	private async siblingsOf(file: string): Promise<FolderConfig[]> {
		const folder = path.dirname(file);
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(folder)
		);
		if (listing.isErr()) return [];
		const siblings: FolderConfig[] = [];
		for (const [name, type] of listing.value) {
			const other = path.join(folder, name);
			if (!isFileType(type) || !isConfigFileName(name) || other === file)
				continue;
			const { resolved, value } = await this.loadFile(other);
			if (resolved.isOk())
				siblings.push({ config: resolved.value.config, value });
		}
		return siblings;
	}

	private async loadFile(file: string): Promise<LoadedConfig> {
		const loaded = await this.reader.read(file);
		if (loaded.isErr()) {
			const failure = loaded.error;
			return {
				files: [file],
				resolved: err([
					...failure.diagnostics,
					...(failure.kind === "invalid"
						? this.hintsOf(file, failure.value)
						: []),
				]),
			};
		}
		const config = loaded.value;
		const value = config.model.contents;
		const hints = this.hintsOf(file, value);
		return {
			files: [file],
			value,
			resolved:
				hints.length > 0
					? err(hints)
					: ConfigValidator.validateFile(config),
		};
	}

	private hintsOf(file: string, value: unknown): Diagnostic[] {
		return [...this.fileChecks].flatMap((check) => [
			...check({ file, value }),
		]);
	}
}
