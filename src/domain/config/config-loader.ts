import path from "path";
import { Disposable, toDisposable } from "../../base/disposable.js";
import { Result, err } from "../../base/result.js";
import {
	ConfigFile,
	ConfigFileReader,
} from "../../platform/config/config-file.js";
import {
	Diagnostic,
	DiagnosticLocation,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { ConfigKeys } from "./config-keys.js";
import { ProjectSourceReader } from "./project-sources.js";
import { configSchema } from "./config-schema.js";
import { ConfigFileCheck } from "./config-service.js";
import { ResolvedConfigFile } from "./resolved-config.js";
import { ConfigValidator } from "./config-validator.js";
import { PlaceFinder } from "./place-finder.js";
import { PlaceLoader } from "./place-loader.js";

/** One read of one config, with everything a reload needs to compare against. */
export interface LoadedConfig {
	/** Every file the config reads. */
	readonly files: readonly string[];
	/** What the file holds, once it could be read. */
	readonly value?: Readonly<Record<string, unknown>>;
	/** What each place's config holds, by file. */
	readonly placeValues?: Readonly<Record<string, unknown>>;
	readonly resolved: Result<ResolvedConfigFile, Diagnostic[]>;
}

/** Reads a config file, then resolves and validates it. */
export class ConfigLoader {
	private readonly reader: ConfigFileReader;
	private readonly fileChecks = new Set<ConfigFileCheck>();
	private readonly places: PlaceLoader;
	private readonly finder: PlaceFinder;

	constructor(fileSystemService: FileReader) {
		this.finder = new PlaceFinder(fileSystemService);
		this.reader = new ConfigFileReader(fileSystemService, configSchema);
		this.places = new PlaceLoader(
			fileSystemService,
			this.reader,
			(file, value) => this.hintsOf(file, value)
		);
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		this.fileChecks.add(check);
		return toDisposable(() => this.fileChecks.delete(check));
	}

	/** Never throws for a problem the user can cause. */
	async load(file: string): Promise<LoadedConfig> {
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
		if (hints.length > 0)
			return { files: [file], value, resolved: err(hints) };
		return this.resolve(config);
	}

	/** Resolves a config that read and passed the file checks: its projects first, then the places it lists. */
	private async resolve(config: ConfigFile): Promise<LoadedConfig> {
		const { file } = config;
		const value = config.model.contents;
		const keys = ConfigKeys.check(
			config.model.keys,
			(key): DiagnosticLocation => ({
				resource: file,
				position: config.positionOfKey(key),
			})
		);
		const declared = new ProjectSourceReader(config).read();
		const failed = [...keys.errors, ...declared.errors];
		if (failed.length > 0)
			return { files: [file], value, resolved: err(failed) };

		const dir = path.dirname(file);
		const placeDirs = (
			await this.finder.folders(
				dir,
				config.model.getValue<string[]>("placePaths") ?? []
			)
		).filter((placeDir) => placeDir !== dir);
		const own = ConfigValidator.validateFile(
			declared.sources,
			declared.serveProject,
			keys.warnings,
			{ placeDirs }
		);
		if (own.isErr())
			return { files: [file], value, resolved: err(own.error) };

		const places = await this.places.load(
			file,
			{
				dir,
				sources: declared.sources,
				serveProject: declared.serveProject,
			},
			placeDirs
		);
		return {
			files: [file, ...places.files],
			value,
			placeValues: places.values,
			resolved: places.resolved.map((resolved) => ({
				...own.value,
				places: resolved,
			})),
		};
	}

	private hintsOf(file: string, value: unknown): Diagnostic[] {
		return [...this.fileChecks].flatMap((check) => [
			...check({ file, value }),
		]);
	}
}
