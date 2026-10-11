import path from "path";
import { Disposable } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { PathSet } from "../../base/path.js";
import { Result, err } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

import { inFamilyOf } from "./config.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { ConfigLoader } from "./config-loader.js";
import { ConfigOverrides } from "./layered-config.js";
import {
	ConfigEntry,
	ConfigFileCheck,
	ConfigOptionValues,
	ReloadableSelection,
	ConfigService,
	EnclosingConfigs,
	OutFileOption,
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
		fileSystemService: FileSystemService,
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
	): Promise<Result<ReloadableSelection, Error>> {
		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		const overrides = overridesOf(options);
		const { home: directory, files, everyConfig } = discovered.value;
		const count = files.length;
		if (overrides.outFile !== undefined && count > 1) {
			const found = everyConfig ? "are here" : "were named";
			return err(
				new UsageError(
					`-${OutFileOption.short} targets a single config, but ${count} configs ${found}. Name one config, or set outFile in the file.`
				)
			);
		}

		const named = await Promise.all(
			files.map((file) =>
				ManagedConfig.open(file, this.loader, overrides)
			)
		);
		const extenders = everyConfig
			? []
			: await this.extendersOf(named, overrides);
		return CoreConfigSelection.create(
			[...named, ...extenders],
			this.loader,
			overrides,
			directory,
			everyConfig
				? { directory, list: () => this.discovery.list(directory) }
				: undefined
		);
	}

	/** The configs beside `named` that extend one of them, loaded without the `-o` that names a single config. A config in a named one's chain can't extend it, so it isn't read again. */
	private async extendersOf(
		named: readonly ManagedConfig[],
		overrides: ConfigOverrides
	): Promise<ManagedConfig[]> {
		const namedFiles = new PathSet(named.map(({ file }) => file));
		const known = new PathSet([
			...named.map(({ file }) => file),
			...named.flatMap(({ entry }) => entry.parents),
		]);
		const folders = new Set(named.map(({ file }) => path.dirname(file)));
		const candidates = (
			await Promise.all(
				[...folders].map((folder) => this.discovery.list(folder))
			)
		)
			.flat()
			.filter((file) => !known.has(file));
		const opened = await Promise.all(
			candidates.map((file) =>
				ManagedConfig.open(file, this.loader, {
					...overrides,
					outFile: undefined,
				})
			)
		);
		return opened.filter(({ file, entry }) =>
			inFamilyOf({ file, parents: entry.parents }, namedFiles)
		);
	}

	findEnclosing(): Promise<EnclosingConfigs | undefined> {
		return this.discovery.findEnclosing();
	}

	async read(file: string): Promise<ConfigEntry> {
		return (await ManagedConfig.open(file, this.loader, { variants: {} }))
			.entry;
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		return this.loader.registerFileCheck(check);
	}
}
