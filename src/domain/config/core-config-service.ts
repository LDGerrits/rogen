import { Disposable } from "../../base/disposable.js";
import { Result, err, ok } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

import { ConfigFormatter } from "./config-formatter.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { isProjectFileConfig } from "./config.js";
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
	private readonly formatter: ConfigFormatter;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {
		this.discovery = new ConfigDiscovery(
			fileSystemService,
			environmentService
		);
		this.loader = new ConfigLoader(fileSystemService);
		this.formatter = new ConfigFormatter(fileSystemService);
	}

	format(file: string): Promise<Result<boolean, Diagnostic[]>> {
		return this.formatter.format(file);
	}

	async select(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>> {
		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		const { home: directory, files, noneNamed, scopes } = discovered.value;
		const opened = await Promise.all(
			files.map((file) => ManagedConfig.open(file, this.loader))
		);
		return ok(
			new CoreConfigSelection(
				opened,
				this.loader,
				directory,
				noneNamed && !files.some(isProjectFileConfig)
					? { directory, list: () => this.firstConfigIn(directory) }
					: undefined,
				scopes
			)
		);
	}

	private async firstConfigIn(directory: string): Promise<string[]> {
		return (await this.discovery.list(directory)).slice(0, 1);
	}

	findEnclosing(from?: string): Promise<EnclosingConfigs | undefined> {
		return this.discovery.findEnclosing(from);
	}

	async read(file: string): Promise<ConfigEntry> {
		return (await ManagedConfig.open(file, this.loader)).entry;
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		return this.loader.registerFileCheck(check);
	}
}
