import path from "path";
import { Sequencer } from "../../base/async.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { FileChange } from "../../platform/fs/file-events.js";
import { ReconciliationService } from "../../platform/watcher/reconciliation-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ConfigService } from "../../platform/config/config.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "watch",
	metadata: {
		description:
			"Builds, then rebuilds whenever sources or configs change.",
		args: [
			{
				name: "name",
				description: "A config to watch.",
				isOptional: true,
				isVariadic: true,
			},
		],
	},
	handler: async (accessor) => {
		const logService = accessor.get(LogService);
		const watcher = accessor.get(Watcher);
		const reconciliationService = accessor.get(ReconciliationService);
		const configService = accessor.get(ConfigService);
		const environmentService = accessor.get(EnvironmentService);

		const buildQueue = new Sequencer();

		const triggerRebuild = (): void => {
			const config = configService.getValue<ResolvedConfig>();
			logService.debug(
				`Triggering full rebuild. Root dirs: ${(config.rootDirs ?? []).join(", ")}`
			);
		};

		const triggerIncrementalBuild = (changes: FileChange[]): void => {
			logService.debug(
				`Triggering incremental build for ${changes.length} files.`
			);
		};

		logService.info("Starting watch mode...");

		triggerRebuild();

		const config = configService.getValue<ResolvedConfig>();

		const sourcePaths = (config.rootDirs ?? []).map((dir) => ({
			path: path.resolve(environmentService.cwd, dir),
			recursive: true,
		}));

		const configPath = configService.configPath;

		await watcher.watch([
			...(configPath ? [{ path: configPath, recursive: false }] : []),
			...sourcePaths,
		]);

		configService.onDidChangeConfig(() => {
			logService.info("Config updated successfully.");
			triggerRebuild();
		});

		watcher.onDidChangeFile((rawChanges) => {
			reconciliationService.queueEvents(rawChanges);
		});

		reconciliationService.onDidEmitChanges((normalizedChanges) => {
			buildQueue.queue(async () => {
				const configChanged =
					configPath !== undefined &&
					normalizedChanges.some((c) => c.path === configPath);

				if (configChanged) {
					logService.info("Config change detected. Reloading...");

					try {
						await configService.reloadConfig();
					} catch (error) {
						logService.warn(
							`Invalid configuration change ignored: ${error instanceof Error ? error.message : String(error)}`
						);
					}
				} else {
					triggerIncrementalBuild(normalizedChanges);
				}
			});
		});

		// Full reconciliation if the burst threshold is hit
		reconciliationService.onDidRequestReconciliation(() => {
			logService.info(
				"Burst threshold reached. Executing full rebuild..."
			);
			triggerRebuild();
		});

		return new Promise(() => {});
	},
});
