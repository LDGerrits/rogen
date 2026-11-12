import { DisposableStore } from "../../base/disposable.js";
import { Result, ok } from "../../base/result.js";
import { WriteRun } from "../../domain/write/write.js";
import { WriteService } from "../../domain/write/write-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
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
import { WatchedConfigs, WriteWatch } from "../write/write-watch.js";
import {
	writeLineShape,
	writeDocument,
	writeDocumentShape,
} from "./write-document.js";
import { WriteLog } from "./write-log.js";
import { RefreshAgentRules } from "./refresh-agent-rules.js";

const WatchOption = {
	name: "watch",
	type: "boolean",
	description:
		"Keep going: write the project files again whenever names or configs change. Press Ctrl+C to stop; --json prints one JSON object per line.",
} as const satisfies OptionDescriptor;

const WriteOptions = [JsonOption, WatchOption] as const;

const WriteArguments = [
	{
		name: "project",
		description:
			"A folder, a .rogen.json file, or a name such as dist for dist.rogen.json. Without one: every .rogen.json here.",
		isOptional: true,
		isVariadic: true,
	},
] as const;

/** The refs of a selection that takes the working directory's default config. */
const FOLDER_DEFAULT: readonly string[] = [];

interface Targets {
	readonly configs: readonly string[];
	/** The project files with no config, which are left alone. */
	readonly plain: readonly string[];
}

/** What the command takes from the accessor before its first await. */
interface Services {
	readonly configService: ConfigService;
	readonly writeService: WriteService;
	readonly logService: LogService;
	readonly cwd: string;
	readonly lifecycleService: LifecycleService;
	readonly instantiationService: InstantiationService;
}

interface Written {
	readonly home: string;
	readonly run: WriteRun;
}

registerCommand(
	class WriteCommand extends AbstractCommand<typeof WriteOptions> {
		constructor() {
			super({
				id: "write",
				metadata: {
					summary: "Writes the project file of every config here",
					description:
						"Writes the project file of every .rogen.json of the working directory, or of the configs you name, beside each (dist.rogen.json writes dist.project.json). A config that does not load does not stop the others; the run then exits 1. A project file with no .rogen.json is left alone.",
					args: WriteArguments,
					options: WriteOptions,
					output: {
						document: writeDocumentShape,
						lines: writeLineShape,
					},
					effects: ["writesFiles"],
					unknownWordOffer: "To write a project file",
					longRunningWith: "watch",
					exitCodes: {
						"1": "a config has errors, or a file could not be written",
						"128+N":
							"--watch stopped by a signal: 130 for Ctrl+C, 143 for SIGTERM, 129 for SIGHUP",
					},
					examples: [
						"rogen write",
						"rogen write projects/lobby",
						"rogen write game lobby",
						"rogen write --watch",
						"rogen write --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof WriteOptions>
		): Promise<Result<void, Error>> {
			const services: Services = {
				configService: accessor.get(ConfigService),
				writeService: accessor.get(WriteService),
				logService: accessor.get(LogService),
				cwd: accessor.get(EnvironmentService).cwd,
				lifecycleService: accessor.get(LifecycleService),
				instantiationService: accessor.get(InstantiationService),
			};
			const targets = await this.targets(
				services.configService,
				line.positionals
			);
			if (targets.isErr()) return targets;
			const json = Boolean(line.options.json);
			await services.instantiationService
				.createInstance(RefreshAgentRules)
				.run(json);
			return line.options.watch
				? this.watch(
						services,
						line.positionals.length === 0
							? "here"
							: line.positionals,
						json
					)
				: this.writeOnce(services, targets.value, json);
		}

		private async watch(
			{ lifecycleService, instantiationService }: Services,
			configs: WatchedConfigs,
			json: boolean
		): Promise<Result<void, Error>> {
			const store = new DisposableStore();
			const shutdown = this.untilShutdown(lifecycleService, store);
			try {
				return await instantiationService
					.createInstance(
						WriteWatch,
						configs,
						json,
						undefined,
						"write"
					)
					.run(store, shutdown);
			} finally {
				store[Symbol.dispose]();
			}
		}

		private async writeOnce(
			services: Services,
			{ configs, plain }: Targets,
			json: boolean
		): Promise<Result<void, Error>> {
			const { logService, cwd, instantiationService } = services;
			const written = await this.writeConfigs(services, configs);
			if (written.isErr()) return written;
			const { home, run } = written.value;

			const failure = run.failure();
			if (json)
				return this.printJson(
					logService,
					writeDocument(run, cwd, plain),
					failure
				);
			instantiationService
				.createInstance(WriteLog, cwd)
				.report(run, home, plain);
			return failure ? this.reported(failure) : ok(undefined);
		}

		/** Writes `configs`, each on its own so one that fails does not stop the rest; nothing to write without configs. */
		private async writeConfigs(
			{ configService, writeService, logService, cwd }: Services,
			configs: readonly string[]
		): Promise<Result<Written, Error>> {
			if (configs.length === 0)
				return ok({ home: cwd, run: new WriteRun([]) });
			const selection = await configService.select(configs);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);
			const run = await writeService.write(selection.value, {
				independent: true,
			});
			return ok({ home: selection.value.home, run });
		}

		/** The configs to write: the ones named, else every one of the working directory, and the plain project files that are left alone. Fails when the folder holds neither. */
		private async targets(
			configService: ConfigService,
			given: readonly string[]
		): Promise<Result<Targets, Error>> {
			if (given.length > 0) return ok({ configs: given, plain: [] });
			const configs = await configService.configsHere();
			const plain = await configService.plainProjectsHere();
			if (configs.length > 0 || plain.length > 0)
				return ok({ configs, plain });
			const nothing = await configService.select(FOLDER_DEFAULT);
			return nothing.isErr() ? nothing : ok({ configs, plain });
		}
	}
);
