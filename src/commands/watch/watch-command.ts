import { DisposableStore } from "../../base/disposable.js";
import { Result, ok } from "../../base/result.js";

import {
	ConfigArguments,
	ConfigService,
} from "../../domain/config/config-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { WatchJsonLog, WatchLog, WatchReporter } from "./watch-log.js";

const WatchOptions = [
	{
		...JsonOption,
		description:
			"Print one JSON object per line: each config change and each build.",
	},
] as const;

registerCommand(
	class WatchCommand extends AbstractCommand<typeof WatchOptions> {
		constructor() {
			super({
				id: "watch",
				metadata: {
					longRunning: true,
					description:
						"Builds, then rebuilds whenever sources or configs change.",
					args: ConfigArguments,
					options: WatchOptions,
					examples: [
						"rogen watch",
						"rogen watch lobby",
						"rogen watch --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof WatchOptions>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const configService = accessor.get(ConfigService);
			const watchService = accessor.get(WatchService);
			const log: WatchReporter = line.options.json
				? new WatchJsonLog(logService)
				: new WatchLog(
						logService,
						accessor.get(EnvironmentService).cwd
					);

			const store = new DisposableStore();
			const shutdown = this.untilShutdown(accessor, store);
			try {
				const selection = await configService.select(line.positionals);
				if (selection.isErr()) return selection;
				for (const note of selection.value.notes) logService.warn(note);
				const watched = watchService.watch(selection.value);
				if (watched.isErr()) return watched;
				const session = store.add(watched.value);
				if (shutdown.isSettled) return ok(undefined);
				log.begin(session.configs, selection.value.home);

				store.add(session.onDidUpdate((update) => log.update(update)));
				store.add(session.onDidError((error) => log.error(error)));
				try {
					const started = await session.start();
					if (started.isErr()) return started;
					await shutdown.p;
				} finally {
					await session.stop();
				}
				log.end();
				return ok(undefined);
			} finally {
				store[Symbol.dispose]();
			}
		}
	}
);
