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
import {
	CONFIG_FILE_NAMES,
	DEFAULT_CONFIG_FILE,
	ResolvedConfigFile,
} from "./config.js";
import { ConfigKeys } from "./config-keys.js";
import { ConfigValidator } from "./config-validator.js";
import { PlacePorts } from "./place-ports.js";
import {
	PlaceBase,
	ProjectSource,
	readProjectSources,
} from "./project-sources.js";

/** The places a config lists, loaded. */
export interface LoadedPlaces {
	/** Every place config file that exists. */
	readonly files: readonly string[];
	/** What each of those holds, by file. */
	readonly values: Readonly<Record<string, unknown>>;
	readonly resolved: Result<ResolvedConfigFile[], Diagnostic[]>;
}

/** One place's config and the sources of its projects, before anything is validated. */
interface PlaceSources {
	readonly sources: readonly ProjectSource[];
	readonly serveProject: string;
	readonly warnings: readonly Diagnostic[];
}

/** Reads the config of each folder a config lists as a place, on top of the config's own. */
export class PlaceLoader {
	constructor(
		private readonly files: FileReader,
		private readonly reader: ConfigFileReader,
		/** What a registered file check says of a place's file. */
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
		const read: PlaceSources[] = [];

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
			const declared = readProjectSources(config, base);
			problems.push(...keys.errors, ...declared.errors);
			read.push({
				sources: declared.sources,
				serveProject: declared.serveProject,
				warnings: keys.warnings,
			});
		}
		if (problems.length > 0)
			return {
				files,
				values,
				resolved: err(uniqueDiagnostics(problems)),
			};

		const ports = PlacePorts.assign(
			read.map(({ sources }) =>
				PlacePorts.pinnedBy(sources[0].model.getValue("servePort"))
			)
		);
		const places = read.map(
			({ sources, serveProject, warnings }, index) => {
				const stems = sources.map(({ stem }) => stem);
				return sources.map((source, position) =>
					new ConfigValidator(
						source,
						serveProject,
						stems,
						position === 0 ? warnings : source.warnings,
						{ rootFile, placePort: ports[index] }
					).validate()
				);
			}
		);
		const failed = places
			.flat()
			.flatMap((result) => (result.isErr() ? result.error : []));
		if (failed.length > 0)
			return { files, values, resolved: err(uniqueDiagnostics(failed)) };
		return {
			files,
			values,
			resolved: ok(
				places.map(([description, ...projects]) => ({
					config: description.unwrap(),
					projects: projects.map((result) => result.unwrap()),
				}))
			),
		};
	}

	/** The config of a place's folder, or an empty one when it holds none. */
	private async read(
		folder: string,
		problems: Diagnostic[],
		files: string[],
		values: Record<string, unknown>
	): Promise<ConfigFile | undefined> {
		const present: string[] = [];
		for (const name of CONFIG_FILE_NAMES) {
			const file = path.join(folder, name);
			if (await this.files.isFile(file)) present.push(file);
		}
		if (present.length > 1) {
			problems.push(
				errorDiagnostic(
					"config.unreadable",
					{ resource: folder },
					`${folder} holds both ${CONFIG_FILE_NAMES.join(" and ")}; keep one.`
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
