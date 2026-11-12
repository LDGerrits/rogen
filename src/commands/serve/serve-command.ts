import { DisposableStore } from "../../base/disposable.js";
import { Result, err, ok } from "../../base/result.js";
import {
	ProjectArgument,
	singleProjectError,
} from "../../domain/config/config-service.js";
import { ServeEnding, ServeService } from "../../domain/serve/serve-service.js";
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
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	ServeJsonLog,
	ServeLog,
	ServeReporter,
	serveLineShape,
} from "./serve-log.js";
import { RefreshAgentRules } from "../write/refresh-agent-rules.js";

const AddressOption = {
	name: "address",
	type: "string",
	placeholder: "address",
	description:
		"The address to listen on. Rojo's own flag; it overrides the project's serveAddress.",
} as const satisfies OptionDescriptor;

const PortOption = {
	name: "port",
	type: "string",
	placeholder: "port",
	description:
		"The port to listen on. Rojo's own flag; it overrides the project's servePort.",
} as const satisfies OptionDescriptor;

const AllowedHostsOption = {
	name: "allowed-hosts",
	type: "string",
	placeholder: "allowed_hosts",
	multiple: true,
	description:
		"A host, besides the address, that may reach the server. Rojo's own flag, from Rojo 7.7.0.",
} as const satisfies OptionDescriptor;

const ServeOptions = [
	{
		...JsonOption,
		description:
			"Print one JSON object per line: each write, each server when it serves, and failures.",
	},
	AddressOption,
	PortOption,
	AllowedHostsOption,
] as const;

type ServeLine = CommandLine<typeof ServeOptions>;

const ServerFlags = [AddressOption, PortOption, AllowedHostsOption] as const;

/** What the server gets: the flags given to serve, in Rojo's own spelling. */
function serverArgsOf(line: ServeLine): string[] {
	const given: string[] = [];
	for (const { name } of ServerFlags) {
		const value = line.options[name];
		if (value === undefined) continue;
		for (const one of typeof value === "string" ? [value] : value)
			given.push(`--${name}`, one);
	}
	return given;
}

registerCommand(
	class ServeCommand extends AbstractCommand<typeof ServeOptions> {
		constructor() {
			super({
				id: "serve",
				metadata: {
					longRunning: true,
					summary:
						"Serves with Rojo, and rewrites the project file on changes",
					description:
						"Writes the project file, serves it with Rojo, and writes it again on every change. A failed write keeps it running: fix the error and it writes again. With --json, a serving line says Studio can connect, and a connected line says a Studio plugin is connected and gets your edits. When none comes, press Connect in the Rojo plugin.",
					args: ProjectArgument,
					options: ServeOptions,
					output: { lines: serveLineShape },
					effects: ["writesFiles", "runsProcesses"],
					exitCodes: {
						"1": "the project has errors, or Rojo failed",
						"0": "another rogen serve already serves the project",
						"128+N":
							"a signal stopped it: 130 for Ctrl+C, 143 for SIGTERM, 129 for SIGHUP",
					},
					examples: [
						"rogen serve",
						"rogen serve lobby --port <port>",
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
			const logService = accessor.get(LogService);
			const { cwd } = accessor.get(EnvironmentService);
			const instantiationService = accessor.get(InstantiationService);

			const store = new DisposableStore();
			const shutdown = this.untilShutdown(
				accessor.get(LifecycleService),
				store
			);
			try {
				await instantiationService
					.createInstance(RefreshAgentRules)
					.run(Boolean(line.options.json));
				const plan = await serveService.prepare({
					signal: shutdown,
					refs: line.positionals,
					serverArgs: serverArgsOf(line),
				});
				if (shutdown.aborted) return ok(undefined);
				if (plan.isErr()) return plan;

				const log: ServeReporter = line.options.json
					? instantiationService.createInstance(
							ServeJsonLog,
							cwd,
							plan.value
						)
					: instantiationService.createInstance(
							ServeLog,
							cwd,
							plan.value
						);
				for (const note of plan.value.selection.notes)
					logService.warn(note);
				log.begin();
				if (plan.value.isIdle) {
					log.end(
						"Nothing to start: another rogen serve already serves this project, so nothing is written or watched here."
					);
					return ok(undefined);
				}
				const session = serveService.serve(plan.value);
				if (session.isErr()) return session;
				const { value } = session;
				store.add(value);
				store.add(value.onDidUpdate((update) => log.update(update)));
				store.add(value.onDidError((error) => log.error(error)));
				store.add(value.onDidServe((serving) => log.serving(serving)));
				store.add(
					value.onDidRestart((restart) => log.restarted(restart))
				);
				store.add(value.onDidOutput((said) => log.said(said)));
				store.add(
					value.onDidConnect((change) => log.connection(change))
				);
				store.add(value.onDidChange((change) => log.changed(change)));
				return this.ended(log, await value.run(shutdown));
			} finally {
				store[Symbol.dispose]();
			}
		}

		private ended(
			log: ServeReporter,
			ending: ServeEnding
		): Result<void, Error> {
			if (ending.kind === "refused") {
				log.abort(ending.error);
				return this.reported(ending.error);
			}
			if (ending.kind === "shutdown") {
				if (ending.exit) log.stopped(ending.exit);
				log.shutdown(ending.ended);
				log.end("Stopped serving.");
				return ok(undefined);
			}
			const { exit } = ending;
			log.stopped(exit);
			switch (exit.kind) {
				case "served-elsewhere":
					log.end(
						"Another rogen serve started serving this project first, so this one stops."
					);
					return ok(undefined);
				case "stopped":
				case "interrupted":
					log.end("Stopped serving.");
					return ok(undefined);
				case "crashed":
				case "failed":
					log.end("serve failed.");
					return this.reported(new DiagnosticsError([exit.failure]));
			}
		}
	}
);
