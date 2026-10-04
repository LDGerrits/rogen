import { Sequencer } from "../../base/async.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import { Config } from "../../platform/config/config-models.js";
import { ConfigOptions } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { AbstractConfigService } from "./abstract-config-service.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { ConfigLoader } from "./config-loader.js";
import {
	ConfigChangeEvent,
	ConfigEntry,
	ConfigOverrides,
	ConfigRefs,
	ConfigSelection,
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

	/** Whether the reload changed the resolved config. */
	async reload(): Promise<boolean> {
		const before = { config: this.config, entry: this.entry };
		await this.load();
		if (!this.config) return false;

		if (!before.config || !before.config.equals(this.config)) return true;
		const template = before.entry.resolved?.template;
		return template
			? !template.equals(this.entry.resolved?.template)
			: this.entry.resolved?.template !== undefined;
	}
}

/** Overrides that name one value, which several configs can't share, by the flag that sets each. */
const SINGLE_CONFIG_OVERRIDES = {
	outFile: "out-file",
	syncDir: "sync-dir",
	template: "template",
} as const;

/** The flag as a user types it, taken from the option table so the two can't drift. */
function flagOf(name: string): string {
	const short = ConfigOptions.find((option) => option.name === name)?.short;
	return short ? `-${short}` : `--${name}`;
}

/** Why `refs` can't be loaded together, before any config is read. */
function selectionProblem({
	names,
	paths,
	all,
	overrides,
}: ConfigRefs): Error | undefined {
	if (all && names.length + paths.length > 0) {
		return new Error(
			"--all already builds every config here, so it takes no names or -c paths. Drop one or the other."
		);
	}
	if (!all && names.length + paths.length <= 1) return undefined;
	const override = Object.entries(SINGLE_CONFIG_OVERRIDES).find(
		([field]) => overrides?.[field as keyof ConfigOverrides] !== undefined
	);
	return override
		? new Error(
				`${flagOf(override[1])} targets a single config, but several were named. Name one config, or set it in the file.`
			)
		: undefined;
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

	async initialize(
		refs: ConfigRefs
	): Promise<Result<ConfigSelection, Error>> {
		const problem = selectionProblem(refs);
		if (problem) return err(problem);

		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		this.overrides = refs.overrides ?? { tags: {} };
		this.managed = await Promise.all(
			discovered.value.map((file) => this.load(file))
		);
		const tags = this.checkTagOverrides();
		if (tags.isErr()) return tags;
		return ok(new ConfigSelection(this.configs, await this.unselected()));
	}

	/** The config files in the working dir that aren't loaded; none when it can't be read. */
	private async unselected(): Promise<string[]> {
		const found = await this.discovery.find();
		const selected = new Set(this.managed.map(({ file }) => file));
		return found.isOk()
			? found.value.filter((file) => !selected.has(file))
			: [];
	}

	async readConfig(file: string): Promise<ConfigEntry> {
		return (await this.load(file)).entry;
	}

	reload(files: readonly string[]): Promise<void> {
		return this.reloads.queue(async () => {
			const changed = new Set(files);
			const reloaded = await Promise.all(
				this.managed.map(async (config) =>
					config.reads(changed) && (await config.reload())
						? config
						: undefined
				)
			);
			for (const config of reloaded) {
				if (config) {
					this._onDidChangeConfig.fire({ resource: config.file });
				}
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
				const declared = this.managed.flatMap((config) =>
					Object.keys(config.entry.resolved?.tags ?? {})
				);
				const suggestion = closestMatch(tag, declared);
				return err(
					new Error(
						`Tag "${tag}" is not declared by any config being built. ` +
							(suggestion
								? `Did you mean "${suggestion}"?`
								: `Add it under "tags" in a config, or drop the flag.`)
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
