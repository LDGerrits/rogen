import { Sequencer } from "../../base/async.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
import { Config } from "../../platform/config/config-models.js";
import { ConfigChangeEvent } from "../../platform/config/config.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { AbstractConfigService } from "./abstract-config-service.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { ConfigLoader } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigOverrides,
	ConfigRefs,
	ConfigService,
} from "./config-service.js";

/** One config file that loads and reloads itself, and keeps its last valid version while the file is broken. */
class ManagedConfig {
	private _entry: ConfigEntry | undefined;
	private config: Config | undefined;
	private _files: readonly string[] = [];
	private _skippedTags: readonly string[] | undefined;

	constructor(
		readonly file: string,
		private readonly loader: ConfigLoader,
		private readonly overrides: ConfigOverrides
	) {}

	/** The latest snapshot; `load` must have finished. */
	get entry(): ConfigEntry {
		if (!this._entry) throw new Error(`${this.file} has not been loaded.`);
		return this._entry;
	}

	/** Every file the config reads: its chain and its template. */
	get files(): readonly string[] {
		return this._files;
	}

	/** The CLI tags this config does not declare; `undefined` when its chain could not be read. */
	get skippedTags(): readonly string[] | undefined {
		return this._skippedTags;
	}

	reads(changed: ReadonlySet<string>): boolean {
		return this._files.some((file) => changed.has(file));
	}

	async load(): Promise<void> {
		const previous = this._entry;
		const loaded = await this.loader.load(this.file, this.overrides);
		this._files = loaded.files;
		this._skippedTags = loaded.skippedTags;

		if (loaded.resolved.isOk()) {
			this.config = loaded.config;
			this._entry = new ConfigEntry({
				file: this.file,
				chain: loaded.chain,
				resolved: loaded.resolved.value,
				diagnostics: [],
				skippedTags: loaded.skippedTags ?? [],
			});
			return;
		}
		// A failed load keeps the last valid config, which is what still gets built.
		this._entry = new ConfigEntry({
			file: this.file,
			chain: loaded.chain,
			resolved: previous?.resolved,
			diagnostics: loaded.resolved.error,
			skippedTags: previous?.resolved
				? previous.skippedTags
				: (loaded.skippedTags ?? []),
		});
	}

	/** What the reload changed in the resolved config, or `undefined` when nothing did. */
	async reload(): Promise<ConfigChangeEvent | undefined> {
		const before = { config: this.config, entry: this.entry };
		await this.load();
		if (!this.config) return undefined;

		const keys = before.config
			? before.config.compare(this.config)
			: this.config.getAllKeys();
		const template = before.entry.resolved?.template;
		if (
			template
				? !template.equals(this.entry.resolved?.template)
				: this.entry.resolved?.template
		) {
			keys.push("template");
		}
		return keys.length > 0
			? new ConfigChangeEvent(keys, this.file)
			: undefined;
	}
}

export class CoreConfigService
	extends AbstractConfigService
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
	private managed: readonly ManagedConfig[] = [];
	private overrides: ConfigOverrides = { tags: {} };

	get configs(): readonly ConfigEntry[] {
		return this.managed.map((config) => config.entry);
	}

	get files(): ReadonlySet<string> {
		return new Set(this.managed.flatMap((config) => config.files));
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
		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		this.overrides = refs.overrides ?? { tags: {} };
		this.managed = await Promise.all(
			discovered.value.map((file) => this.load(file))
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
		return (await this.load(file)).entry;
	}

	reload(files: readonly string[]): Promise<void> {
		return this.reloads.queue(async () => {
			const changed = new Set(files);
			const events = await Promise.all(
				this.managed.map((config) =>
					config.reads(changed) ? config.reload() : undefined
				)
			);
			for (const event of events) {
				if (event) this._onDidChangeConfig.fire(event);
			}
		});
	}

	private checkTagOverrides(): Result<void, Error> {
		const allReadable = this.managed.every(
			(config) => config.skippedTags !== undefined
		);
		for (const tag of Object.keys(this.overrides.tags)) {
			const skipped = this.managed.filter((config) =>
				config.skippedTags?.includes(tag)
			);
			if (allReadable && skipped.length === this.managed.length) {
				return err(
					new Error(
						`Tag "${tag}" is not declared by any config being built. Add it under "tags" in a config, or drop the flag.`
					)
				);
			}
		}
		return ok(undefined);
	}

	private async load(file: string): Promise<ManagedConfig> {
		const config = new ManagedConfig(file, this.loader, this.overrides);
		await config.load();
		return config;
	}
}
