import { DeferredPromise, Sequencer } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { err, ok } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { FileChange } from "../../platform/fs/file-events.js";
import { ReconciliationService } from "../../platform/watcher/reconciliation-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { requireValidConfigs } from "../../domain/config/valid-configs.js";
import { DiagnosticSeverity } from "../../platform/diagnostics/diagnostic.js";
import { renderDiagnostics } from "../../platform/diagnostics/render-diagnostic.js";
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
		const lifecycleService = accessor.get(LifecycleService);

		const configs = requireValidConfigs(configService);
		if (configs.isErr()) return configs;

		const store = new DisposableStore();
		const buildQueue = new Sequencer();
		const shutdown = new DeferredPromise<void>();

		const queueBuild = (build: () => Promise<void> | void): void => {
			void buildQueue.queue(async () => {
				if (!shutdown.isSettled) await build();
			});
		};

		const rebuild = (): void => {
			const rootDirs = configService.configs.flatMap(
				(entry) => entry.resolved?.rootDirs ?? []
			);
			logService.debug(
				`Triggering full rebuild. Root dirs: ${rootDirs.join(", ")}`
			);
		};

		const incrementalBuild = (changes: FileChange[]): void => {
			logService.debug(
				`Triggering incremental build for ${changes.length} files.`
			);
		};

		const onChanges = async (changes: FileChange[]): Promise<void> => {
			const configFiles = changes
				.map((change) => change.path)
				.filter((file) => configService.files.has(file));
			if (configFiles.length === 0) {
				incrementalBuild(changes);
				return;
			}

			logService.info("Config change detected. Reloading...");
			await configService.reload(configFiles);
			for (const entry of configService.configs) {
				const errors = entry.diagnostics.filter(
					(diagnostic) =>
						diagnostic.severity === DiagnosticSeverity.Error
				);
				if (errors.length > 0) {
					logService.warn(
						`Invalid configuration change ignored:\n${renderDiagnostics(errors)}`
					);
				}
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

			await watcher.watch([
				...[...configService.files].map((file) => ({
					path: file,
					recursive: false,
				})),
				...configs.value
					.flatMap((config) => config.rootDirs)
					.map((dir) => ({ path: dir, recursive: true })),
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
