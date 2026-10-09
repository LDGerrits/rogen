import { ReportedError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigOptions } from "../../domain/config/config.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "./build-log.js";
import { BuildReport } from "./build-report.js";

const DenyWarningsOption = {
	name: "deny-warnings",
	type: "boolean",
	description: "Exit 1 when any config has a warning.",
} as const satisfies OptionDescriptor;

const BuildOptions = [
	...ConfigOptions,
	JsonOption,
	DenyWarningsOption,
] as const;

registerCommand(
	class BuildCommand extends AbstractCommand<typeof BuildOptions> {
		constructor() {
			super({
				id: "build",
				metadata: {
					description:
						"Writes the project file of each config here, or of the named ones.",
					args: [
						{
							name: "config",
							description:
								"A config's name (lobby for lobby.rogen.json, wherever it is) or path. When none is given, every config here and each one below that extends one here, or those of the nearest folder above that has any.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: BuildOptions,
					unknownWordOffer: "To build a config",
					examples: [
						"rogen build",
						"rogen build places/lobby.rogen.json --variant mock",
						"rogen build --json",
						"rogen build --mode prod --deny-warnings",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof BuildOptions>
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const logService = accessor.get(LogService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const selection = await configService.select(
				line.positionals,
				line.options
			);
			if (selection.isErr()) return selection;

			const built = await buildService.build(selection.value);
			if (built.isErr()) return built;
			const run = built.value;

			const denyWarnings = Boolean(line.options["deny-warnings"]);
			const failure =
				run.errors.length > 0
					? new DiagnosticsError(run.errors)
					: denyWarnings && run.warningCount > 0
						? new Error("--deny-warnings")
						: undefined;
			if (line.options.json) {
				const report = new BuildReport();
				for (const build of run.builds) report.add(build);
				return this.printJson(logService, report.json(), failure);
			}
			new BuildLog(logService, cwd).report(
				run,
				selection.value.home,
				denyWarnings
			);
			return failure ? err(new ReportedError(failure)) : ok(undefined);
		}
	}
);
