import { Disposable } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Result, err } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ConfigOptionValues, OutFileOption } from "./config.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { ConfigLoader } from "./config-loader.js";
import { ConfigTree } from "./config-tree.js";
import { ConfigOverrides } from "./layered-config.js";
import {
	ConfigEntry,
	ConfigFileCheck,
	ConfigSelection,
	ConfigService,
	EnclosingConfigs,
} from "./config-service.js";
import { CoreConfigSelection } from "./core-config-selection.js";
import { ManagedConfig } from "./managed-config.js";

/** The overrides the command line's flags set; `--no-variant` beats `--variant` for one variant. */
function overridesOf(options: ConfigOptionValues): ConfigOverrides {
	return {
		outFile: options["out-file"],
		mode: options.mode,
		variants: {
			...Object.fromEntries(
				(options.variant ?? []).map((variant) => [variant, true])
			),
			...Object.fromEntries(
				(options["no-variant"] ?? []).map((variant) => [variant, false])
			),
		},
	};
}

export class CoreConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly discovery: ConfigDiscovery;
	private readonly loader: ConfigLoader;

	constructor(
		private readonly fileSystemService: FileSystemService,
		environmentService: EnvironmentService
	) {
		this.discovery = new ConfigDiscovery(
			fileSystemService,
			environmentService
		);
		this.loader = new ConfigLoader(fileSystemService, environmentService);
	}

	async select(
		refs: readonly string[],
		options: ConfigOptionValues
	): Promise<Result<ConfigSelection, Error>> {
		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		const overrides = overridesOf(options);
		const { directory, files, everyConfig, separate, folders } =
			discovered.value;
		const count = files.length;
		if (overrides.outFile !== undefined && count > 1) {
			const found = everyConfig ? "are here" : "were named";
			return err(
				new UsageError(
					`-${OutFileOption.short} targets a single config, but ${count} configs ${found}. Name one config, or set outFile in the file.`
				)
			);
		}

		return CoreConfigSelection.load(
			files,
			this.loader,
			overrides,
			directory,
			everyConfig
				? {
						folder: {
							directory,
							read: () =>
								ConfigTree.read(
									this.fileSystemService,
									directory
								),
						},
						found: { members: files, separate, folders },
					}
				: undefined
		);
	}

	findEnclosing(): Promise<EnclosingConfigs | undefined> {
		return this.discovery.findEnclosing();
	}

	async find(directory: string): Promise<readonly string[]> {
		return (await ConfigTree.read(this.fileSystemService, directory))
			.members;
	}

	async read(file: string): Promise<ConfigEntry> {
		const config = new ManagedConfig(file, this.loader, { variants: {} });
		await config.load();
		return config.entry;
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		return this.loader.registerFileCheck(check);
	}
}
