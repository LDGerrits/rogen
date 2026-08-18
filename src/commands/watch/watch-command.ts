import { Command } from "../command.js";
import { CliArgs } from "../args.js";
import { Result, err } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { ResolvedConfig } from "../../domain/config/config-schema.js";
import { ConfigReader } from "../../platform/config/config-reader.js";
import { ConfigParser } from "../../domain/config/config-parser.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { FileChange } from "../../platform/fs/file-events.js";
import path from "path";
import { ReconciliationService } from "../../platform/watcher/reconciliation-service.js";
import { Sequencer } from "../../base/async.js";

export class WatchCommand implements Command {
	private currentConfig: ResolvedConfig;
	private readonly buildQueue = new Sequencer();

	constructor(
		private readonly logService: LogService,
		private readonly watcher: Watcher,
		private readonly reconciliationService: ReconciliationService,
		private readonly fs: FileSystemService,
		private readonly configPath: string,
		private readonly configOverrides: Record<string, unknown>,
		initialConfig: ResolvedConfig
	) {
		this.currentConfig = initialConfig;
	}

	async execute(_args: CliArgs): Promise<Result<void, Error>> {
		this.logService.info("Starting watch mode...");

		this.triggerRebuild();

		const sourcePaths = this.currentConfig.source.map((src) => ({
			path: path.resolve(process.cwd(), src),
			recursive: true,
		}));

		await this.watcher.watch([
			{ path: this.configPath, recursive: false },
			...sourcePaths,
		]);

		this.watcher.onDidChangeFile((rawChanges) => {
			this.reconciliationService.queueEvents(rawChanges);
		});

		this.reconciliationService.onDidEmitChanges((normalizedChanges) => {
			this.buildQueue.queue(async () => {
				const configChanged = normalizedChanges.some(
					(c) => c.path === this.configPath
				);

				if (configChanged) {
					this.logService.info(
						"Configuration change detected. Reloading..."
					);
					const reloadResult = await this.attemptReload();

					if (reloadResult.isOk()) {
						this.logService.info(
							"Configuration updated successfully."
						);
						this.currentConfig = reloadResult.unwrap();
						this.triggerRebuild();
					} else {
						this.logService.warn(
							`Invalid configuration change ignored: ${reloadResult.error.message}`
						);
					}
				} else {
					this.triggerIncrementalBuild(normalizedChanges);
				}
			});
		});

		// Full reconciliation if the burst threshold is hit
		this.reconciliationService.onDidRequestReconciliation(() => {
			this.logService.info(
				"Burst threshold reached. Executing full rebuild..."
			);
			this.triggerRebuild();
		});

		return new Promise(() => {});
	}

	private async attemptReload(): Promise<Result<ResolvedConfig, Error>> {
		const reader = new ConfigReader(this.fs);
		const rawResult = await reader.read({
			configPath: this.configPath,
			isOptional: false, // If the file is deleted, it's an error
			overrides: this.configOverrides,
		});

		if (rawResult.isErr()) return err(rawResult.error);

		const configDir = path.dirname(this.configPath);

		return await ConfigParser.parse(rawResult.unwrap(), configDir, this.fs);
	}

	private triggerRebuild(): void {
		this.logService.debug(
			`Triggering full rebuild with config: ${this.currentConfig.casing}`
		);
	}

	private triggerIncrementalBuild(changes: FileChange[]): void {
		this.logService.debug(
			`Triggering incremental build for ${changes.length} files.`
		);
	}
}
