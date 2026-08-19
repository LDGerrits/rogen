import path from "path";
import { Command } from "../command.js";
import { Result } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { FileChange } from "../../platform/fs/file-events.js";
import { ReconciliationService } from "../../platform/watcher/reconciliation-service.js";
import { Sequencer } from "../../base/async.js";
import { ParsedArgs } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { CoreConfigService } from "../../platform/config/config-service.js";
import { ResolvedConfig } from "../../domain/config/config.js";

export class WatchCommand implements Command {
	private readonly buildQueue = new Sequencer();

	constructor(
		private readonly logService: LogService,
		private readonly watcher: Watcher,
		private readonly reconciliationService: ReconciliationService,
		private readonly configService: CoreConfigService,
		private readonly environmentService: EnvironmentService
	) {}

	async execute(_args: ParsedArgs): Promise<Result<void, Error>> {
		this.logService.info("Starting watch mode...");

		this.triggerRebuild();

		const config = this.configService.getValue<ResolvedConfig>();

		const sourcePaths = config.source.map((src) => ({
			path: path.resolve(this.environmentService.cwd, src),
			recursive: true,
		}));

		const configPath = this.environmentService.args.config
			? path.resolve(
					this.environmentService.cwd,
					this.environmentService.args.config
				)
			: path.join(this.environmentService.cwd, ".rogen.json");

		await this.watcher.watch([
			{ path: configPath, recursive: false },
			...sourcePaths,
		]);

		this.configService.onDidChangeConfig(() => {
			this.logService.info("Config updated successfully.");
			this.triggerRebuild();
		});

		this.watcher.onDidChangeFile((rawChanges) => {
			this.reconciliationService.queueEvents(rawChanges);
		});

		this.reconciliationService.onDidEmitChanges((normalizedChanges) => {
			this.buildQueue.queue(async () => {
				const configChanged = normalizedChanges.some(
					(c) => c.path === configPath
				);

				if (configChanged) {
					this.logService.info(
						"Config change detected. Reloading..."
					);

					try {
						await this.configService.reloadConfig();
					} catch (error) {
						this.logService.warn(
							`Invalid configuration change ignored: ${error instanceof Error ? error.message : String(error)}`
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

	private triggerRebuild(): void {
		const config = this.configService.getValue<ResolvedConfig>();
		this.logService.debug(
			`Triggering full rebuild with config: ${config.casing}`
		);
	}

	private triggerIncrementalBuild(changes: FileChange[]): void {
		this.logService.debug(
			`Triggering incremental build for ${changes.length} files.`
		);
	}
}
