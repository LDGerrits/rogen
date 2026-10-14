import { Disposable, toDisposable } from "../../base/disposable.js";
import { Result, err } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	ConfigFile,
	ConfigFileReader,
} from "../../platform/config/config-file.js";
import {
	Diagnostic,
	DiagnosticLocation,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	configRemovedFieldAdvice,
	configSchema,
	rogenKeys,
	rojoKeys,
} from "./config-schema.js";
import { ConfigFileCheck } from "./config-service.js";
import { ResolvedConfig } from "./config.js";
import { ConfigValidator } from "./config-validator.js";

/** One read of one config, with everything a reload needs to compare against. */
export interface LoadedConfig {
	/** Every file the config reads. */
	readonly files: readonly string[];
	/** What the file holds, once it could be read. */
	readonly value?: Readonly<Record<string, unknown>>;
	readonly resolved: Result<ResolvedConfig, Diagnostic[]>;
}

const KNOWN_KEYS: readonly string[] = [...rojoKeys, ...rogenKeys];

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

		const keys = ConfigLoader.checkKeys(config);
		if (keys.errors.length > 0)
			return { files: [file], value, resolved: err(keys.errors) };
		const resolved = new ConfigValidator(config, keys.warnings).validate();
		return { files: [file], value, resolved };
	}

	/** A key Rogen read once is told as removed; one that is neither Rojo's nor Rogen's passes through with a warning. */
	private static checkKeys(config: ConfigFile): {
		readonly errors: Diagnostic[];
		readonly warnings: Diagnostic[];
	} {
		const errors: Diagnostic[] = [];
		const warnings: Diagnostic[] = [];
		for (const key of config.model.keys) {
			if (KNOWN_KEYS.includes(key)) continue;
			const location: DiagnosticLocation = {
				resource: config.file,
				position: config.positionOfKey(key),
			};
			const removed = configRemovedFieldAdvice(key, location);
			if (removed) {
				errors.push(removed);
				continue;
			}
			const suggestion = closestMatch(
				key,
				KNOWN_KEYS.filter((known) => !config.model.keys.includes(known))
			);
			warnings.push(
				warningDiagnostic(
					"config.unknownField",
					location,
					`"${key}" is not a Rojo key and not Rogen's: it is passed through, and Rojo will reject the written file by this name.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`
				)
			);
		}
		return { errors, warnings };
	}

	private hintsOf(file: string, value: unknown): Diagnostic[] {
		return [...this.fileChecks].flatMap((check) => [
			...check({ file, value }),
		]);
	}
}
