import path from "path";
import { Result, err, ok } from "../../base/result.js";
import {
	ConfigFile,
	ConfigFileReader,
} from "../../platform/config/config-file.js";
import { ConfigModel } from "../../platform/config/config-models.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { DEFAULT_CONFIG_FILE, DEFAULT_CONFIG_FILE_NAMES } from "./config.js";
import { ResolvedConfigFile } from "./resolved-config.js";
import { ConfigKeys } from "./config-keys.js";
import { ConfigValidator } from "./config-validator.js";
import { PlacePorts } from "./place-ports.js";
import {
	ConfigSource,
	ConfigSourceReader,
	PlaceBase,
} from "./config-sources.js";

interface LoadedPlaces {
	readonly files: readonly string[];
	readonly values: Readonly<Record<string, unknown>>;
	readonly resolved: Result<ResolvedConfigFile[], Diagnostic[]>;
}

/** Reads the config of each folder a config lists as a place, on top of the config's own. */
export class PlaceLoader {
	constructor(
		private readonly files: FileReader,
		private readonly reader: ConfigFileReader,
		private readonly hintsOf: (file: string, value: unknown) => Diagnostic[]
	) {}

	async load(
		rootFile: string,
		base: PlaceBase,
		folders: readonly string[]
	): Promise<LoadedPlaces> {
		const files: string[] = [];
		const values: Record<string, unknown> = {};
		const problems: Diagnostic[] = [];
		const read: ConfigSource[] = [];

		for (const folder of folders) {
			const config = await this.read(folder, problems, files, values);
			if (!config) continue;
			const keys = ConfigKeys.check(
				config.model.keys,
				(key): DiagnosticLocation => ({
					resource: config.file,
					position: config.positionOfKey(key),
				})
			);
			const declared = new ConfigSourceReader(config, base).read();
			problems.push(...keys, ...declared.errors);
			read.push(declared.source);
		}
		if (problems.length > 0)
			return {
				files,
				values,
				resolved: err(uniqueDiagnostics(problems)),
			};

		const portOf = (source: ConfigSource) =>
			PlacePorts.pinnedBy(source.model.getValue("servePort"));
		const ports = PlacePorts.assign(read.map(portOf));
		const places = read.map((source, index) =>
			ConfigValidator.validateFile(source, {
				rootFile,
				placePort: ports[index],
			})
		);
		const failed = places.flatMap((result) =>
			result.isErr() ? result.error : []
		);
		if (failed.length > 0)
			return { files, values, resolved: err(uniqueDiagnostics(failed)) };
		return {
			files,
			values,
			resolved: ok(places.map((result) => result.unwrap())),
		};
	}

	private async read(
		folder: string,
		problems: Diagnostic[],
		files: string[],
		values: Record<string, unknown>
	): Promise<ConfigFile | undefined> {
		const present: string[] = [];
		for (const name of DEFAULT_CONFIG_FILE_NAMES) {
			const file = path.join(folder, name);
			if (await this.files.isFile(file)) present.push(file);
		}
		if (present.length > 1) {
			problems.push(
				errorDiagnostic(
					"config.unreadable",
					{ resource: folder },
					`${folder} holds both ${DEFAULT_CONFIG_FILE_NAMES.join(" and ")}; keep one.`
				)
			);
			return undefined;
		}
		if (present.length === 0)
			return {
				file: path.join(folder, DEFAULT_CONFIG_FILE),
				model: new ConfigModel(),
				positionOf: () => undefined,
				positionOfKey: () => undefined,
			};
		const [file] = present;
		files.push(file);
		const loaded = await this.reader.read(file);
		if (loaded.isErr()) {
			const failure = loaded.error;
			problems.push(
				...failure.diagnostics,
				...(failure.kind === "invalid"
					? this.hintsOf(file, failure.value)
					: [])
			);
			return undefined;
		}
		values[file] = loaded.value.model.contents;
		const hints = this.hintsOf(file, loaded.value.model.contents);
		problems.push(...hints);
		return hints.length > 0 ? undefined : loaded.value;
	}
}
