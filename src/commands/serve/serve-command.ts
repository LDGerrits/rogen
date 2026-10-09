import { DeferredPromise } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import {
	ErrorUtils,
	ExitCodeError,
	ReportedError,
	UsageError,
} from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { ConfigOptions } from "../../domain/config/config.js";
import { SyncServer } from "../../domain/serve/serve.js";
import {
	ServePlan,
	ServerStop,
	ServeService,
	ServeSession,
} from "../../domain/serve/serve-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { ServeLog } from "./serve-log.js";

const ToolOption = {
	name: "tool",
	type: "string",
	placeholder: "rojo|argon",
	description:
		"Serves with this sync server; without it, the one the project pins, Rojo before Argon.",
} as const satisfies OptionDescriptor;

const ServeOptions = [
	...ConfigOptions,
	ToolOption,
	{
		...JsonOption,
		description:
			"Print one JSON object per line: each build, each server when it serves, and failures.",
	},
] as const;

type ServeLine = CommandLine<typeof ServeOptions>;

registerCommand(
	class ServeCommand extends AbstractCommand<typeof ServeOptions> {
		constructor() {
			super({
				id: "serve",
				metadata: {
					description:
						"Builds, serves the project files with Rojo or Argon, and rebuilds whenever sources or configs change.",
					args: [
						{
							name: "config",
							description:
								"A config to serve, by name or path. Every config here is built and watched either way; without names, each one no other config extends is served.",
							isOptional: true,
							isVariadic: true,
						},
					],
					passthrough: {
						name: "server args",
						description:
							"Passed to the server untouched, such as --port 34873.",
					},
					options: ServeOptions,
					examples: [
						"rogen serve",
						"rogen serve lobby --tool argon",
						"rogen serve -- --port 34873",
					],
				},
			});
		}

		/** Serves until the process is asked to shut down, or a server stops. */
		async run(
			accessor: ServicesAccessor,
			line: ServeLine
		): Promise<Result<void, Error>> {
			const serveService = accessor.get(ServeService);
			const json = Boolean(line.options.json);
			const log = new ServeLog(
				accessor.get(LogService),
				accessor.get(EnvironmentService).cwd,
				json
			);
			const failed = (error: Error) => {
				log.failure(error);
				return err(new ReportedError(error));
			};

			// Subscribed first, so Ctrl+C while the server or the ports are checked still stops the run.
			const store = new DisposableStore();
			const shutdown = new DeferredPromise<void>();
			store.add(
				accessor
					.get(LifecycleService)
					.onWillShutdown(() => shutdown.complete())
			);
			try {
				const server = this.serverOf(line);
				if (server.isErr()) return failed(server.error);
				const plan = await serveService.prepare({
					refs: line.positionals,
					options: line.options,
					server: server.value,
					serverArgs: line.passthrough ?? [],
				});
				// Ctrl+C reaches the server's --version check too, so its failure says nothing then.
				if (shutdown.isSettled) return ok(undefined);
				if (plan.isErr()) return failed(plan.error);

				log.begin(plan.value);
				if (plan.value.toStart.length === 0) {
					log.end(
						"Nothing to start: every config is already served, so nothing is built or watched here."
					);
					return ok(undefined);
				}
				const session = serveService.serve(plan.value);
				if (session.isErr()) return failed(session.error);
				store.add(session.value);
				return await this.serve(
					session.value,
					plan.value,
					log,
					shutdown
				);
			} catch (error) {
				return failed(ErrorUtils.fromUnknown(error));
			} finally {
				store[Symbol.dispose]();
			}
		}

		/** Runs `session` until shutdown or until a server stops, and answers with the server's exit code when it failed. */
		private async serve(
			session: ServeSession,
			plan: ServePlan,
			log: ServeLog,
			shutdown: DeferredPromise<void>
		): Promise<Result<void, Error>> {
			const store = new DisposableStore();
			const stopped = new DeferredPromise<ServerStop>();
			store.add(session.onDidUpdate((update) => log.update(update)));
			store.add(session.onDidError((error) => log.error(error)));
			store.add(session.onDidServe((serving) => log.serving(serving)));
			store.add(session.onDidSay((said) => log.said(said, plan)));
			store.add(
				session.onDidChange((change) => log.changed(change, plan))
			);
			store.add(
				session.onDidStop((stop) => {
					log.stopped(stop, plan);
					if (!stopped.isSettled) stopped.complete(stop);
				})
			);
			void shutdown.p.then(() => session.stop());
			try {
				const started = await session.start();
				if (started.isErr()) {
					log.failure(started.error, true);
					return err(new ReportedError(started.error));
				}
				const stop = await Promise.race([
					shutdown.p.then(() => undefined),
					stopped.p,
				]);
				const running = session.targets;
				await session.stop();
				if (!stop) log.shutdown(plan, running);
				if (!stop?.failure) {
					log.end("Stopped serving.");
					return ok(undefined);
				}
				log.end("serve failed.");
				return err(
					new ReportedError(
						new ExitCodeError(
							stop.exitCode ?? 1,
							new DiagnosticsError([stop.failure])
						)
					)
				);
			} finally {
				await session.stop();
				store[Symbol.dispose]();
			}
		}

		private serverOf(
			line: ServeLine
		): Result<SyncServer | undefined, UsageError> {
			const id = line.options.tool;
			if (id === undefined) return ok(undefined);
			const server = SyncServer.byId(id);
			return server
				? ok(server)
				: err(
						new UsageError(
							`--tool takes ${SyncServer.ALL.map(({ id }) => id).join(" or ")}, not "${id}".`
						)
					);
		}
	}
);
