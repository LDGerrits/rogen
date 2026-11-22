import path from "path";
import { Result, err, tryWithAsync } from "../../base/result.js";
import { ConfigFileReader } from "../../platform/config/config-file.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { isFileType } from "../../platform/fs/file-system-service.js";
import {
	isConfigFileName,
	isProjectFileConfig,
	projectFileOf,
} from "./config.js";
import { FolderConfig, folderClashes } from "./folder-clashes.js";
import { configStructure } from "./config-structure.js";
import { ConfigFileCheck } from "./config-service.js";
import { ResolvedConfigFile } from "./resolved-config.js";
import { ConfigValidator } from "./config-validator.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

export interface LoadedConfig {
	readonly files: readonly string[];
	readonly value?: Readonly<Record<string, unknown>>;
	readonly text?: string;
	readonly resolved: Result<ResolvedConfigFile, Diagnostic[]>;
	readonly sourcePaths?: readonly string[];
}

const twinOf = (file: string): string =>
	file.endsWith("c") ? file.slice(0, -1) : `${file}c`;

const bothExtensions = (file: string, twin: string): Diagnostic =>
	errorDiagnostic(
		"config.bothExtensions",
		{ resource: file },
		`${path.basename(file)} and ${path.basename(twin)} both write ${path.basename(projectFileOf(file))}. Keep one of them.`
	);

export class ConfigLoader {
	private readonly reader: ConfigFileReader;

	constructor(
		private readonly checks: ReadonlySet<ConfigFileCheck>,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@InstantiationService instantiationService: InstantiationService
	) {
		this.reader = instantiationService.createInstance(
			ConfigFileReader,
			configStructure
		);
	}

	async load(file: string): Promise<LoadedConfig> {
		const loaded = await this.loadFile(file);
		if (isProjectFileConfig(file)) return loaded;
		const twin = twinOf(file);
		if (loaded.resolved.isErr())
			return { ...loaded, files: [...loaded.files, twin] };
		const { siblings, read } = await this.siblingsOf(file);
		const clashes = [
			...(read.includes(twin) ? [bothExtensions(file, twin)] : []),
			...folderClashes(
				{ config: loaded.resolved.value.config, value: loaded.value! },
				siblings
			),
		];
		const files = [...loaded.files, ...new Set([...read, twin])];
		return clashes.length > 0
			? {
					files,
					value: loaded.value,
					text: loaded.text,
					resolved: err(clashes),
					sourcePaths: loaded.resolved.value.config.sourcePaths,
				}
			: { ...loaded, files };
	}

	private async siblingsOf(
		file: string
	): Promise<{ siblings: FolderConfig[]; read: string[] }> {
		const folder = path.dirname(file);
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(folder)
		);
		if (listing.isErr()) return { siblings: [], read: [] };
		const siblings: FolderConfig[] = [];
		const read: string[] = [];
		for (const [name, type] of listing.value) {
			const other = path.join(folder, name);
			if (!isFileType(type) || !isConfigFileName(name) || other === file)
				continue;
			read.push(other);
			const { resolved, value } = await this.loadFile(other);
			if (resolved.isOk())
				siblings.push({ config: resolved.value.config, value: value! });
		}
		return { siblings, read };
	}

	private async loadFile(file: string): Promise<LoadedConfig> {
		const loaded = await this.reader.read(file);
		if (loaded.isErr()) {
			const failure = loaded.error;
			const sourcePaths =
				failure.kind === "invalid"
					? ConfigValidator.sourcePathsIn(file, failure.value)
					: undefined;
			return {
				files: [file],
				resolved: err([
					...failure.diagnostics,
					...(failure.kind === "invalid"
						? this.hintsOf(file, failure.value)
						: []),
				]),
				...(sourcePaths && { sourcePaths }),
			};
		}
		const config = loaded.value;
		const value = config.model.contents;
		const hints = this.hintsOf(file, value);
		const resolved =
			hints.length > 0
				? err(hints)
				: ConfigValidator.validateFile(config);
		return {
			files: [file],
			value,
			text: config.text,
			resolved,
			...(resolved.isErr() && {
				sourcePaths: ConfigValidator.sourcePathsIn(file, value),
			}),
		};
	}

	private hintsOf(file: string, value: unknown): Diagnostic[] {
		return [...this.checks].flatMap((check) => [...check({ file, value })]);
	}
}
