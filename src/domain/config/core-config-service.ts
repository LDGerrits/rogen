import path from "path";
import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { safeStringify } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import { Config } from "../../platform/config/config-models.js";
import { ConfigChangeEvent } from "../../platform/config/config.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { loadConfigChain } from "./config-chain.js";
import { discoverConfigPaths } from "./config-discovery.js";
import { layerConfig, locateConfigValue } from "./config-layers.js";
import { resolveConfig } from "./config-resolver.js";
import { readTemplate } from "./config-template.js";
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
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService,
		private readonly logService: LogService
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

		this.overrides = refs.overrides ?? { tags: {} };
		this.slots = await Promise.all(
			discovered.value.map((file) => this.load(file, undefined))
		);
		return this.checkTagOverrides();
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
		for (const tag of Object.keys(this.overrides.tags)) {
			const skipped = this.slots.filter((slot) =>
				slot.undeclaredTags?.includes(tag)
			);
			if (
				this.slots.every((slot) => slot.undeclaredTags !== undefined) &&
				skipped.length === this.slots.length
			) {
				return err(
					new Error(
						`Tag "${tag}" is not declared by any config being built. Add it under "tags" in a config, or drop the flag.`
					)
				);
			}
			for (const slot of skipped) {
				this.logService.debug(
					`Tag "${tag}" is not declared in ${path.basename(slot.entry.file)}; skipped there.`
				);
			}
		}
		return ok(undefined);
	}

	private async load(
		file: string,
		previous: ConfigSlot | undefined
	): Promise<ConfigSlot> {
		const chain = await loadConfigChain(this.fileSystemService, file);
		const failed = (
			diagnostics: readonly Diagnostic[],
			files: readonly string[] = chain.files,
			undeclaredTags?: readonly string[]
		): ConfigSlot => ({
			config: previous?.config,
			files,
			undeclaredTags,
			entry: {
				file,
				chain: chain.files,
				resolved: previous?.entry.resolved,
				diagnostics,
			},
		});
		if (chain.diagnostics.length > 0) return failed(chain.diagnostics);

		const layered = layerConfig(
			chain.layers,
			this.overrides,
			this.environmentService.cwd
		);
		const templateFile = layered.config.getValue<string | undefined>(
			"template"
		);
		const files = templateFile
			? [...chain.files, templateFile]
			: chain.files;

		const template = templateFile
			? await readTemplate(
					this.fileSystemService,
					templateFile,
					locateConfigValue(layered, "template")
				)
			: undefined;
		if (template?.isErr()) {
			return failed(template.error, files, layered.undeclaredTags);
		}

		const resolved = resolveConfig(
			layered,
			template?.isOk() ? template.value : undefined
		);
		if (resolved.isErr()) {
			return failed(resolved.error, files, layered.undeclaredTags);
		}

		return {
			config: layered.config,
			files,
			undeclaredTags: layered.undeclaredTags,
			entry: {
				file,
				chain: chain.files,
				resolved: resolved.value,
				diagnostics: [],
			},
		};
	}
}
