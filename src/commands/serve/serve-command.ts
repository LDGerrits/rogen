import { DeferredPromise } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { UsageError, onUnexpectedError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	ProjectArgument,
	singleProjectError,
} from "../../domain/config/config-service.js";
import {
	ServerExitEvent,
	ServeService,
	ServeSession,
} from "../../domain/serve/serve-service.js";
import {
	AbstractCommand,
	registerCommand,
	ExitCodeError,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import {
	LifecycleService,
	exitCodeOfSignal,
} from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	ServeJsonLog,
	ServeLog,
	ServeReporter,
	serveLineShape,
} from "./serve-log.js";

const AddressOption = {
	name: "address",
	type: "string",
	placeholder: "address",
	description:
		"The address to listen on, for one project. Rojo's own flag; a project's serveAddress sets it in default.rogen.json.",
} as const satisfies OptionDescriptor;

const PortOption = {
	name: "port",
	type: "string",
	placeholder: "port",
	description:
		"The port to listen on, for one project. Rojo's own flag; a project's servePort sets it in default.rogen.json.",
} as const satisfies OptionDescriptor;

const AllowedHostsOption = {
	name: "allowed-hosts",
	type: "string",
	placeholder: "allowed_hosts",
	multiple: true,
	description:
		"A host, besides the address, that may reach every server. Rojo's own flag, from Rojo 7.7.0.",
} as const satisfies OptionDescriptor;

const AdoptOption = {
	name: "adopt",
	type: "boolean",
	description:
		"Take over a server no rogen serve started that serves this project: build and watch for it, start none. Without it, that server holds the port.",
} as const satisfies OptionDescriptor;

const ServeOptions = [
	{
		...JsonOption,
		description:
			"Print one JSON object per line: each build, each server when it serves, and failures.",
	},
	AddressOption,
	PortOption,
	AllowedHostsOption,
	AdoptOption,
] as const;

type ServeLine = CommandLine<typeof ServeOptions>;

const ServerFlags = [AddressOption, PortOption, AllowedHostsOption] as const;

/** What the server gets: Rojo's flags given to serve, then the words after `--`. */
function serverArgsOf(line: ServeLine): Result<string[], UsageError> {
	const passthrough = line.passthrough ?? [];
	const given: string[] = [];
	for (const { name } of ServerFlags) {
		const value = line.options[name];
		if (value === undefined) continue;
		const flag = `--${name}`;
		if (
			passthrough.some(
				(arg) => arg === flag || arg.startsWith(`${flag}=`)
			)
		)
			return err(
				new UsageError(
					`${flag} is given twice, as an option and after '--'.`,
					"Give it once."
				)
			);
		for (const one of typeof value === "string" ? [value] : value)
			given.push(flag, one);
	}
	return ok([...given, ...passthrough]);
}

registerCommand(
	class ServeCommand extends AbstractCommand<typeof ServeOptions> {
		constructor() {
			super({
				id: "serve",
				metadata: {
					longRunning: true,
					summary:
						"Builds, serves with Rojo, and rebuilds on changes",
					description:
						"Builds the project file, serves it with Rojo, and rebuilds on every change. With no project it serves default.rogen.json of this folder; name another file (rogen serve dist) to serve that.",
					args: ProjectArgument,
					passthrough: {
						name: "server args",
						description:
							"Passed to every server untouched, after the flags above.",
					},
					options: ServeOptions,
					output: { lines: serveLineShape },
					effects: ["writesFiles", "runsProcesses"],
					exitCodes: {
						"0": "another rogen serve already serves the project, or a server adopted from one stopped",
						"128+N":
							"a signal stopped it: 130 for Ctrl+C, 143 for SIGTERM, 129 for SIGHUP",
					},
					examples: [
						"rogen serve",
						"rogen serve places/lobby --port 34873",
						"rogen serve dist",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: ServeLine
		): Promise<Result<void, Error>> {
			const tooMany = singleProjectError(
				"serve",
				line.positionals,
				"Serve a second place from a second terminal, as 'rogen serve <project> --port <port>'."
			);
			if (tooMany) return err(tooMany);
			const serveService = accessor.get(ServeService);
			if (!line.options.json) accessor.get(LogService).reserveStdout();
			const serverArgs = serverArgsOf(line);
			if (serverArgs.isErr()) return serverArgs;

			const store = new DisposableStore();
			const shutdown = this.untilShutdown(accessor, store);
			const stopChecks = new AbortController();
			void shutdown.p.then(() => stopChecks.abort());
			try {
				const plan = await serveService.prepare({
					signal: stopChecks.signal,
					refs: line.positionals,
					serverArgs: serverArgs.value,
					adopt: line.options.adopt === true,
				});
				if (shutdown.isSettled)
					return this.stoppedBy(accessor.get(LifecycleService));
				if (plan.isErr()) return plan;

				const log: ServeReporter = line.options.json
					? new ServeJsonLog(accessor.get(LogService), plan.value)
					: new ServeLog(
							accessor.get(LogService),
							accessor.get(EnvironmentService).cwd,
							plan.value
						);
				for (const note of plan.value.selection.notes)
					accessor.get(LogService).warn(note);
				log.begin();
				if (plan.value.isIdle) {
					log.end(
						"Nothing to start: another rogen serve already serves this project, so nothing is built or watched here."
					);
					return ok(undefined);
				}
				const session = serveService.serve(plan.value);
				if (session.isErr()) return session;
				store.add(session.value);
				return await this.serve(
					accessor.get(LifecycleService),
					session.value,
					log,
					shutdown
				);
			} finally {
				store[Symbol.dispose]();
			}
		}

		/** Ok, unless a signal stopped the run, which ends it as a shell reports a process the signal stopped. */
		private stoppedBy(lifecycle: LifecycleService): Result<void, Error> {
			const { signal } = lifecycle;
			return signal === undefined
				? ok(undefined)
				: this.reported(
						new ExitCodeError(
							exitCodeOfSignal(signal),
							new Error(`Stopped by ${signal}.`)
						)
					);
		}

		private async serve(
			lifecycle: LifecycleService,
			session: ServeSession,
			log: ServeReporter,
			shutdown: DeferredPromise<void>
		): Promise<Result<void, Error>> {
			const store = new DisposableStore();
			const stopped = new DeferredPromise<ServerExitEvent>();
			store.add(session.onDidUpdate((update) => log.update(update)));
			store.add(session.onDidError((error) => log.error(error)));
			store.add(session.onDidServe((serving) => log.serving(serving)));
			store.add(session.onDidOutput((said) => log.said(said)));
			store.add(session.onDidConnect((change) => log.connection(change)));
			store.add(session.onDidChange((change) => log.changed(change)));
			store.add(
				session.onDidExit((stop) => {
					log.stopped(stop);
					stopped.complete(stop);
				})
			);
			void shutdown.p.then(() => session.stop()).catch(onUnexpectedError);
			try {
				const started = await session.start();
				if (started.isErr()) {
					log.abort(started.error);
					return this.reported(started.error);
				}
				const stop = await Promise.race([
					shutdown.p.then(() => undefined),
					stopped.p,
				]);
				await session.stop();
				if (!stop) log.shutdown(session.target);
				if (!stop?.failure) {
					log.end("Stopped serving.");
					return stop ? ok(undefined) : this.stoppedBy(lifecycle);
				}
				log.end("serve failed.");
				return this.reported(
					new ExitCodeError(
						stop.exitCode,
						new DiagnosticsError([stop.failure])
					)
				);
			} finally {
				await session.stop();
				store[Symbol.dispose]();
			}
		}
	}
);
