import { Disposable, toDisposable } from "../../base/disposable.js";
import { Result, err } from "../../base/result.js";
import { ConfigFileReader } from "../../platform/config/config-file.js";
import {
	Diagnostic,
	DiagnosticLocation,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { ConfigKeys } from "./config-keys.js";
import { readProjectSources } from "./project-sources.js";
import { configSchema } from "./config-schema.js";
import { ConfigFileCheck } from "./config-service.js";
import { ResolvedConfigFile } from "./config.js";
import { ConfigValidator } from "./config-validator.js";

/** One read of one config, with everything a reload needs to compare against. */
export interface LoadedConfig {
	/** Every file the config reads. */
	readonly files: readonly string[];
	/** What the file holds, once it could be read. */
	readonly value?: Readonly<Record<string, unknown>>;
	readonly resolved: Result<ResolvedConfigFile, Diagnostic[]>;
}

/** Reads a config file, then resolves and validates it. */
export class ConfigLoader {
	private readonly reader: ConfigFileReader;
	private readonly fileChecks = new Set<ConfigFileCheck>();

	constructor(fileSystemService: FileReader) {
		this.reader = new ConfigFileReader(fileSystemService, configSchema);
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

		const keys = ConfigKeys.check(
			config.model.keys,
			(key): DiagnosticLocation => ({
				resource: config.file,
				position: config.positionOfKey(key),
			})
		);
		const declared = readProjectSources(config);
		const failed = [...keys.errors, ...declared.errors];
		if (failed.length > 0)
			return { files: [file], value, resolved: err(failed) };

		const [description, ...changed] = declared.sources;
		const stems = declared.sources.map(({ stem }) => stem);
		const resolvedDescription = new ConfigValidator(
			description,
			declared.serveProject,
			stems,
			keys.warnings
		).validate();
		const resolvedProjects = changed.map((source) =>
			new ConfigValidator(
				source,
				declared.serveProject,
				stems,
				source.warnings
			).validate()
		);
		const problems = [resolvedDescription, ...resolvedProjects].flatMap(
			(result) => (result.isErr() ? result.error : [])
		);
		if (problems.length > 0)
			return {
				files: [file],
				value,
				resolved: err(uniqueDiagnostics(problems)),
			};
		return {
			files: [file],
			value,
			resolved: resolvedDescription.map((resolvedConfig) => ({
				config: resolvedConfig,
				projects: resolvedProjects.flatMap((result) =>
					result.isOk() ? [result.value] : []
				),
			})),
		};
	}

	private hintsOf(file: string, value: unknown): Diagnostic[] {
		return [...this.fileChecks].flatMap((check) => [
			...check({ file, value }),
		]);
	}
}
