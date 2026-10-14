import { Disposable } from "../../base/disposable.js";
import { Result, err, ok } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

import { ConfigDiscovery } from "./config-discovery.js";
import { ConfigLoader } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigFileCheck,
	ReloadableSelection,
	ConfigService,
	EnclosingConfigs,
} from "./config-service.js";
import { CoreConfigSelection } from "./core-config-selection.js";
import { ManagedConfig } from "./managed-config.js";

export class CoreConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly discovery: ConfigDiscovery;
	private readonly loader: ConfigLoader;

	constructor(
		fileSystemService: FileSystemService,
		environmentService: EnvironmentService
	) {
		this.discovery = new ConfigDiscovery(
			fileSystemService,
			environmentService
		);
		this.loader = new ConfigLoader(fileSystemService);
	}

	async select(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>> {
		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		const { home: directory, files, everyConfig } = discovered.value;
		const named = await Promise.all(
			files.map((file) => ManagedConfig.open(file, this.loader))
		);
		return ok(
			new CoreConfigSelection(
				named,
				this.loader,
				directory,
				everyConfig
					? { directory, list: () => this.configsIn(directory) }
					: undefined
			)
		);
	}

	/** The config of `directory` a followed folder holds: the first when both names appear, since it takes a restart to refuse that. */
	private async configsIn(directory: string): Promise<string[]> {
		return (await this.discovery.list(directory)).slice(0, 1);
	}

	findEnclosing(): Promise<EnclosingConfigs | undefined> {
		return this.discovery.findEnclosing();
	}

	async read(file: string): Promise<ConfigEntry> {
		return (await ManagedConfig.open(file, this.loader)).entry;
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		return this.loader.registerFileCheck(check);
	}
}
