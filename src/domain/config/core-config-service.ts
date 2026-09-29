import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { safeStringify } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import { Config } from "../../platform/config/config-models.js";
import { ConfigChangeEvent } from "../../platform/config/config.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { ConfigLoader } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigOverrides,
	ConfigRefs,
	ConfigService,
} from "./config-service.js";

interface ConfigSlot {
	readonly entry: ConfigEntry;
	/** The merged config behind `entry.resolved`, kept to see what a reload changed. */
	readonly config: Config | undefined;
	/** Every file the entry reads: its chain and its template. */
	readonly files: readonly string[];
	/** The CLI tags this config does not declare; `undefined` when its chain could not be read. */
	readonly undeclaredTags: readonly string[] | undefined;
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

	private readonly discovery: ConfigDiscovery;
	private readonly loader: ConfigLoader;
	private readonly reloads = new Sequencer();
	private slots: readonly ConfigSlot[] = [];
	private overrides: ConfigOverrides = { tags: {} };

	get configs(): readonly ConfigEntry[] {
		return this.slots.map((slot) => slot.entry);
	}

	get files(): ReadonlySet<string> {
		return new Set(this.slots.flatMap((slot) => slot.files));
	}

	constructor(
		fileSystemService: FileSystemService,
		environmentService: EnvironmentService
	) {
		super();
		this.discovery = new ConfigDiscovery(
			fileSystemService,
			environmentService
		);
		this.loader = new ConfigLoader(fileSystemService, environmentService);
	}

	async initialize(refs: ConfigRefs): Promise<Result<void, Error>> {
		const discovered = await this.discovery.discover(
			refs.names,
			refs.paths,
			refs.all
		);
		if (discovered.isErr()) return err(discovered.error);

		this.overrides = refs.overrides ?? { tags: {} };
		this.slots = await Promise.all(
			discovered.value.map((file) => this.load(file, undefined))
		);
		return this.checkTagOverrides();
	}

	async listConfigFiles(): Promise<string[]> {
		const found = await this.discovery.find();
		return found.isOk() ? found.value : [];
	}

	async listUnselectedConfigFiles(): Promise<string[]> {
		const selected = new Set(this.configs.map(({ file }) => file));
		return (await this.listConfigFiles()).filter(
			(file) => !selected.has(file)
		);
	}

	async readConfig(file: string): Promise<ConfigEntry> {
		return (await this.load(file, undefined)).entry;
	}

	reload(files: readonly string[]): Promise<void> {
		return this.reloads.queue(async () => {
			const changed = new Set(files);
			const previous = this.slots;
			const next = await Promise.all(
				previous.map((slot) =>
					slot.files.some((file) => changed.has(file))
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
				if (
					safeStringify(before.entry.resolved?.template) !==
					safeStringify(after.entry.resolved?.template)
				) {
					keys.push("template");
				}
				if (keys.length > 0) {
					this._onDidChangeConfig.fire(
						new ConfigChangeEvent(keys, after.entry.file)
					);
				}
			});
		});
	}

	private checkTagOverrides(): Result<void, Error> {
		const allReadable = this.slots.every(
			(slot) => slot.undeclaredTags !== undefined
		);
		for (const tag of Object.keys(this.overrides.tags)) {
			const skipped = this.slots.filter((slot) =>
				slot.undeclaredTags?.includes(tag)
			);
			if (allReadable && skipped.length === this.slots.length) {
				return err(
					new Error(
						`Tag "${tag}" is not declared by any config being built. Add it under "tags" in a config, or drop the flag.`
					)
				);
			}
		}
		return ok(undefined);
	}

	private async load(
		file: string,
		previous: ConfigSlot | undefined
	): Promise<ConfigSlot> {
		const loaded = await this.loader.load(file, this.overrides);
		if (loaded.resolved.isOk()) {
			return {
				config: loaded.config,
				files: loaded.files,
				undeclaredTags: loaded.undeclaredTags,
				entry: {
					file,
					chain: loaded.chain,
					resolved: loaded.resolved.value,
					diagnostics: [],
					skippedTags: loaded.undeclaredTags ?? [],
				},
			};
		}
		// A failed load keeps the last valid config, which is what still gets built.
		return {
			config: previous?.config,
			files: loaded.files,
			undeclaredTags: loaded.undeclaredTags,
			entry: {
				file,
				chain: loaded.chain,
				resolved: previous?.entry.resolved,
				diagnostics: loaded.resolved.error,
				skippedTags: previous?.entry.resolved
					? previous.entry.skippedTags
					: (loaded.undeclaredTags ?? []),
			},
		};
	}
}
