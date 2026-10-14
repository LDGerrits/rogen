import { CancelledError, UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildRun } from "../../domain/build/build.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { InitPlan, InitService } from "../../domain/init/init-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { InitJsonLog, InitLog, InitReporter } from "./init-log.js";

const InitOptions = [
	{
		name: "non-interactive",
		type: "boolean",
		description:
			"Write the defaults without asking, as a run without a terminal, or under a coding agent or CI, does. --json implies it.",
	},
	JsonOption,
] as const;

registerCommand(
	class InitCommand extends AbstractCommand<typeof InitOptions> {
		constructor() {
			super({
				id: "init",
				metadata: {
					description:
						"Writes a starting rogen.json, detecting the workspace and asking in a terminal. With a folder below a config, adds it as a place of that config.",
					args: [
						{
							name: "path",
							description:
								"A folder below a rogen.json to add as a place of it: its own rogen.json with the port it is served on, its entry in the config's placePaths when none lists it, and a .code-workspace that lists the config's folder and every place.",
							isOptional: true,
						},
					],
					options: InitOptions,
					examples: [
						"rogen init",
						"rogen init --non-interactive",
						"rogen init places/lobby",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof InitOptions>
		): Promise<Result<void, Error>> {
			if (line.positionals.length > 1)
				return err(
					new UsageError("init takes one folder, the place to add.")
				);
			const initService = accessor.get(InitService);
			const logService = accessor.get(LogService);
			const log = new InitLog(
				logService,
				accessor.get(EnvironmentService).cwd
			);
			// A JSON document is read by a program, which can't answer a question.
			const ask = !line.options["non-interactive"] && !line.options.json;

			if (!line.options.json) log.intro();
			const planned = await initService.plan({
				ask,
				place: line.positionals[0],
			});
			if (planned.isErr()) return planned;
			const plan = planned.value;
			if (!plan) return err(new CancelledError("init cancelled."));

			const reporter: InitReporter = line.options.json
				? new InitJsonLog(logService, plan.directory)
				: log;
			reporter.begin(plan);
			const written = await initService.write(plan, (item) =>
				reporter.written(item)
			);
			if (written.isErr()) return reporter.failed(written.error);
			const built = await this.buildConfigs(accessor, plan);
			if (built.isErr()) return reporter.failed(built.error);
			return reporter.done(plan, built.value);
		}

		/** The project file of the config the plan wrote, so `rojo serve` and the compiler have one to read. */
		private async buildConfigs(
			accessor: ServicesAccessor,
			plan: InitPlan
		): Promise<Result<BuildRun, Error>> {
			// No names would select every config in the folder.
			if (plan.configs.length === 0) return ok(new BuildRun([]));
			const selection = await accessor
				.get(ConfigService)
				.select(plan.configs);
			if (selection.isErr()) return selection;
			return ok(await accessor.get(BuildService).build(selection.value));
		}
	}
);
