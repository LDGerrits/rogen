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
import { ConfigService } from "../../domain/config/config-service.js";

export class WatchCommand implements Command {
	private readonly buildQueue = new Sequencer();

	constructor(
		private readonly logService: LogService,
		private readonly watcher: Watcher,
		private readonly reconciliationService: ReconciliationService,
		private readonly configService: ConfigService,
		private readonly NativeEnvironmentService: EnvironmentService
	) {}

	async execute(_args: ParsedArgs): Promise<Result<void, Error>> {
		this.logService.info("Starting watch mode...");

		this.triggerRebuild();

		const config = this.configService.getValue();

		const sourcePaths = config.source.map((src) => ({
			path: path.resolve(this.NativeEnvironmentService.cwd, src),
			recursive: true,
		}));

		const configPath = this.NativeEnvironmentService.args.config
			? path.resolve(
					this.NativeEnvironmentService.cwd,
					this.NativeEnvironmentService.args.config
				)
			: path.join(this.NativeEnvironmentService.cwd, ".rogen.json");

		await this.watcher.watch([
			{ path: configPath, recursive: false },
			...sourcePaths,
		]);

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
						"Configuration change detected. Reloading..."
					);

					// Delegate the heavy lifting to the configuration domain
					const reloadResult = await this.configService.reload();

					if (reloadResult.isOk()) {
						this.logService.info(
							"Configuration updated successfully."
						);
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

	private triggerRebuild(): void {
		const config = this.configService.getValue();
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
