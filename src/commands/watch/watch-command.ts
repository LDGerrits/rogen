import { DeferredPromise } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import {
	ConfigService,
	configRefsFromArgs,
} from "../../domain/config/config-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { ConfigOptions, ParsedArgs } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { WatchLog } from "./watch-log.js";

registerCommand(
	class WatchCommand extends AbstractCommand {
		constructor() {
			super({
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
					options: ConfigOptions,
				},
			});
		}

		/** Watches until the process is asked to shut down. */
		async run(
			accessor: ServicesAccessor,
			args: ParsedArgs
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const watchService = accessor.get(WatchService);
			const lifecycleService = accessor.get(LifecycleService);
			const log = new WatchLog(
				logService,
				accessor.get(EnvironmentService).cwd
			);

			const loaded = await configService.initialize(
				configRefsFromArgs(args, args._.slice(1))
			);
			if (loaded.isErr()) return loaded;
			const targets = buildService.requireBuildable(
				configService.configs
			);
			if (targets.isErr()) return targets;
			log.begin(
				targets.value,
				await configService.listUnselectedConfigFiles()
			);

			const store = new DisposableStore();
			const shutdown = new DeferredPromise<void>();
			const session = store.add(watchService.watch());
			try {
				store.add(
					lifecycleService.onWillShutdown(() => shutdown.complete())
				);
				store.add(session.onDidUpdate((update) => log.update(update)));
				store.add(
					session.onDidError((error) =>
						logService.error(error.message)
					)
				);
				await session.start();
				await shutdown.p;
			} catch (error) {
				return err(ErrorUtils.fromUnknown(error));
			} finally {
				await session.stop();
				store[Symbol.dispose]();
			}
			log.end();
			return ok(undefined);
		}
	}
);
