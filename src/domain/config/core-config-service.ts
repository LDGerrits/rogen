import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
import { Config } from "../../platform/config/config-models.js";
import { ConfigChangeEvent } from "../../platform/config/config.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { loadConfigChain } from "./config-chain.js";
import { discoverConfigPaths } from "./config-discovery.js";
import { layerConfig, resolveConfig } from "./config-resolver.js";
import { ConfigEntry, ConfigRefs, ConfigService } from "./config-service.js";

interface ConfigSlot {
	readonly entry: ConfigEntry;
	/** The merged config behind `entry.resolved`, kept to see what a reload changed. */
	readonly config: Config | undefined;
}

export class CoreConfigService
	extends AbstractDisposable
	implements ConfigService
{
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfig = this._register(
		new Emitter<ConfigChangeEvent>()
	);
	readonly onDidChangeConfig: Event<ConfigChangeEvent> =
		this._onDidChangeConfig.event;

	private readonly reloads = new Sequencer();
	private slots: readonly ConfigSlot[] = [];

	get configs(): readonly ConfigEntry[] {
		return this.slots.map((slot) => slot.entry);
	}

	get files(): ReadonlySet<string> {
		return new Set(this.slots.flatMap((slot) => slot.entry.chain));
	}

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {
		super();
	}

	async initialize(refs: ConfigRefs): Promise<Result<void, Error>> {
		const discovered = await discoverConfigPaths(
			this.fileSystemService,
			this.environmentService.cwd,
			refs.names,
			refs.paths
		);
		if (discovered.isErr()) return err(discovered.error);

		this.slots = await Promise.all(
			discovered.value.map((file) => this.load(file, undefined))
		);
		return ok(undefined);
	}

	reload(files: readonly string[]): Promise<void> {
		return this.reloads.queue(async () => {
			const changed = new Set(files);
			const previous = this.slots;
			const next = await Promise.all(
				previous.map((slot) =>
					slot.entry.chain.some((file) => changed.has(file))
						? this.load(slot.entry.file, slot)
						: slot
				)
			);
			this.slots = next;

			previous.forEach((before, index) => {
				const after = next[index];
				if (after === before || !after.config) return;
				const keys = before.config
					? before.config.compare(after.config)
					: after.config.getAllKeys();
				if (keys.length > 0) {
					this._onDidChangeConfig.fire(
						new ConfigChangeEvent(keys, after.entry.file)
					);
				}
			});
		});
	}

	private async load(
		file: string,
		previous: ConfigSlot | undefined
	): Promise<ConfigSlot> {
		const chain = await loadConfigChain(this.fileSystemService, file);
		const failed = (diagnostics: readonly Diagnostic[]): ConfigSlot => ({
			config: previous?.config,
			entry: {
				file,
				chain: chain.files,
				resolved: previous?.entry.resolved,
				diagnostics,
			},
		});
		if (chain.diagnostics.length > 0) return failed(chain.diagnostics);

		const layered = layerConfig(chain.layers);
		return {
			config: layered.config,
			entry: {
				file,
				chain: chain.files,
				resolved: resolveConfig(layered),
				diagnostics: [],
			},
		};
	}
}
