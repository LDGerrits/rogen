import { CancelledError } from "../../base/errors.js";
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
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { InitJson, InitLog } from "./init-log.js";

const InitOptions = [
	{
		name: "yes",
		short: "y",
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
						"Writes a starting config, detecting the workspace and asking in a terminal.",
					args: [
						{
							name: "name",
							description:
								"The config to write. Defaults to default. Beside an existing default.rogen.json, a run that doesn't ask adds it as a place: its code in places/<name>/src, beside a template with its name and its own servePort.",
							isOptional: true,
						},
					],
					options: InitOptions,
					examples: [
						"rogen init",
						"rogen init lobby",
						"rogen init -y",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof InitOptions>
		): Promise<Result<void, Error>> {
			const initService = accessor.get(InitService);
			const logService = accessor.get(LogService);
			// A JSON document is read by a program, which can't answer a question.
			const ask = !line.options.yes && !line.options.json;

			if (!line.options.json) logService.intro("rogen init");
			const planned = await initService.plan(line.positionals, { ask });
			if (planned.isErr()) return planned;
			const plan = planned.value;
			if (!plan) return err(new CancelledError("init cancelled."));

			return line.options.json
				? this.writeAsJson(accessor, plan)
				: this.writeAsText(accessor, plan);
		}

		/** The project file of every config the plan wrote, so `rojo serve` and the compiler have one to read. */
		private async buildConfigs(
			accessor: ServicesAccessor,
			plan: InitPlan
		): Promise<Result<BuildRun, Error>> {
			// No names would select every config in the folder.
			if (plan.configs.length === 0) return ok(new BuildRun([]));
			const selection = await accessor
				.get(ConfigService)
				.select(plan.configs, {});
			if (selection.isErr()) return selection;
			return ok(await accessor.get(BuildService).build(selection.value));
		}

		private async writeAsText(
			accessor: ServicesAccessor,
			plan: InitPlan
		): Promise<Result<void, Error>> {
			const log = new InitLog(
				accessor.get(LogService),
				accessor.get(EnvironmentService).cwd
			);
			log.begin(plan);
			const written = await accessor
				.get(InitService)
				.write(plan, (item) => log.written(item));
			if (written.isErr()) return written;

			const built = await this.buildConfigs(accessor, plan);
			if (built.isErr()) return built;
			log.built(built.value);
			log.end(plan, built.value);
			const { errors } = built.value;
			return errors.length > 0
				? this.reported(new DiagnosticsError(errors))
				: ok(undefined);
		}

		/** A failed write still names the files written before it, so a program knows what is on disk. */
		private async writeAsJson(
			accessor: ServicesAccessor,
			plan: InitPlan
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const json = new InitJson(plan.directory);
			const written = await accessor
				.get(InitService)
				.write(plan, (item) => json.add(item));
			if (written.isErr())
				return this.printJson(
					logService,
					json.failed(written.error),
					written.error
				);
			const built = await this.buildConfigs(accessor, plan);
			if (built.isErr())
				return this.printJson(
					logService,
					json.failed(built.error),
					built.error
				);
			return this.printJson(
				logService,
				json.done(plan, built.value),
				DiagnosticsError.of(built.value.errors)
			);
		}
	}
);
