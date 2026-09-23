import path from "path";
import { DeferredPromise, Sequencer } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { err, ok } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { FileChange } from "../../platform/fs/file-events.js";
import { ReconciliationService } from "../../platform/watcher/reconciliation-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
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
		requiresConfig: true,
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
		const lifecycleService = accessor.get(LifecycleService);

		const store = new DisposableStore();
		const buildQueue = new Sequencer();
		const shutdown = new DeferredPromise<void>();

		const queueBuild = (build: () => Promise<void> | void): void => {
			void buildQueue.queue(async () => {
				if (!shutdown.isSettled) await build();
			});
		};

		const rebuild = (): void => {
			const config = configService.getValue<ResolvedConfig>();
			logService.debug(
				`Triggering full rebuild. Root dirs: ${(config.rootDirs ?? []).join(", ")}`
			);
		};

		const incrementalBuild = (changes: FileChange[]): void => {
			logService.debug(
				`Triggering incremental build for ${changes.length} files.`
			);
		};

		const configPath = configService.configPath;

		const onChanges = async (changes: FileChange[]): Promise<void> => {
			if (!changes.some((c) => c.path === configPath)) {
				incrementalBuild(changes);
				return;
			}

			logService.info("Config change detected. Reloading...");
			try {
				await configService.reloadConfig();
			} catch (error) {
				logService.warn(
					`Invalid configuration change ignored: ${ErrorUtils.fromUnknown(error).message}`
				);
			}
		};

		try {
			store.add(
				lifecycleService.onWillShutdown(() => shutdown.complete())
			);
			store.add(
				configService.onDidChangeConfig(() => {
					logService.info("Config updated successfully.");
					queueBuild(rebuild);
				})
			);
			store.add(
				watcher.onDidChangeFile((changes) =>
					reconciliationService.queueEvents(changes)
				)
			);
			store.add(
				reconciliationService.onDidEmitChanges((changes) =>
					queueBuild(() => onChanges(changes))
				)
			);
			store.add(
				reconciliationService.onDidRequestReconciliation(() => {
					logService.info(
						"Burst threshold reached. Executing full rebuild..."
					);
					queueBuild(rebuild);
				})
			);

			logService.info("Starting watch mode...");

			const config = configService.getValue<ResolvedConfig>();
			await watcher.watch([
				...(configPath ? [{ path: configPath, recursive: false }] : []),
				...(config.rootDirs ?? []).map((dir) => ({
					path: path.resolve(environmentService.cwd, dir),
					recursive: true,
				})),
			]);

			// Build only once the watcher is live, so no change goes unseen.
			queueBuild(rebuild);

			await shutdown.p;

			return ok(undefined);
		} catch (error) {
			return err(ErrorUtils.fromUnknown(error));
		} finally {
			store[Symbol.dispose]();
			await watcher.stop();
		}
	},
});
