import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";

import {
	ConfigArguments,
	ConfigOptions,
	ConfigService,
} from "../../domain/config/config-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { WatchLog } from "./watch-log.js";

registerCommand(
	class WatchCommand extends AbstractCommand<typeof ConfigOptions> {
		constructor() {
			super({
				id: "watch",
				metadata: {
					description:
						"Builds, then rebuilds whenever sources or configs change.",
					args: ConfigArguments,
					options: ConfigOptions,
					examples: [
						"rogen watch",
						"rogen watch lobby --variant dev",
					],
				},
			});
		}

		/** Watches until the process is asked to shut down. */
		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof ConfigOptions>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const configService = accessor.get(ConfigService);
			const watchService = accessor.get(WatchService);
			const log = new WatchLog(
				logService,
				accessor.get(EnvironmentService).cwd
			);

			// Subscribed first, so Ctrl+C while the configs load still stops the run.
			const store = new DisposableStore();
			const shutdown = this.untilShutdown(accessor, store);
			try {
				const selection = await configService.select(
					line.positionals,
					line.options
				);
				if (selection.isErr()) return selection;
				const watched = watchService.watch(selection.value);
				if (watched.isErr()) return watched;
				const session = store.add(watched.value);
				if (shutdown.isSettled) return ok(undefined);
				// The watch started, so every config is valid.
				log.begin(
					selection.value.requireValid().unwrap(),
					selection.value.home
				);

				store.add(session.onDidUpdate((update) => log.update(update)));
				store.add(
					session.onDidError((error) =>
						logService.error(error.message)
					)
				);
				try {
					await session.start();
					await shutdown.p;
				} finally {
					await session.stop();
				}
				log.end();
				return ok(undefined);
			} catch (error) {
				return err(ErrorUtils.fromUnknown(error));
			} finally {
				store[Symbol.dispose]();
			}
		}
	}
);
