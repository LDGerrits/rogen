import { DeferredPromise } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { BuildLog } from "../build/build-log.js";
import { ConfigOptions } from "../config-options.js";
import { WatchLog } from "./watch-log.js";

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
				namesConfig: true,
			},
		],
		options: ConfigOptions,
	},
	handler: async (accessor) => {
		const logService = accessor.get(LogService);
		const lifecycleService = accessor.get(LifecycleService);
		const configService = accessor.get(ConfigService);
		const buildService = accessor.get(BuildService);
		const watchService = accessor.get(WatchService);
		const cwd = accessor.get(EnvironmentService).cwd;

		const buildable = buildService.checkBuildable(configService.configs);
		if (buildable.isErr()) return buildable;
		new BuildLog(logService, cwd).begin(
			"watch",
			buildable.value,
			await configService.listUnselectedConfigFiles()
		);

		const watchLog = new WatchLog(logService, cwd);

		const store = new DisposableStore();
		const shutdown = new DeferredPromise<void>();
		const session = store.add(watchService.watch());
		try {
			store.add(
				lifecycleService.onWillShutdown(() => shutdown.complete())
			);
			store.add(session.onDidUpdate((update) => watchLog.update(update)));
			store.add(
				session.onDidError((error) => logService.error(error.message))
			);

			await session.start();
			await shutdown.p;
			await session.stop();
			logService.outro("Stopped watching.");
			return ok(undefined);
		} catch (error) {
			return err(ErrorUtils.fromUnknown(error));
		} finally {
			await session.stop();
			store[Symbol.dispose]();
		}
	},
});
