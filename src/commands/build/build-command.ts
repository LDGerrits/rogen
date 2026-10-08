import { ReportedError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { ConfigBuild } from "../../domain/build/build.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigOptions } from "../../domain/config/config.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "./build-log.js";
import { BuildReport } from "./build-report.js";

const BuildOptions = [...ConfigOptions, JsonOption] as const;

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
								"A config's name (lobby for lobby.rogen.json) or path. Every config here, or in the nearest folder above that has any, when none is given.",
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

			const builds = await buildService.build(selection.value);
			if (builds.isErr()) return builds;

			const errors = builds.value.flatMap((build) =>
				build.outcome === "failed" || build.outcome === "notLoaded"
					? build.errors
					: []
			);
			return line.options.json
				? this.reportAsJson(logService, builds.value, errors)
				: this.report(
						new BuildLog(logService, cwd),
						builds.value,
						errors,
						selection.value.home
					);
		}

		private report(
			log: BuildLog,
			builds: readonly ConfigBuild[],
			errors: readonly Diagnostic[],
			home: string
		): Result<void, Error> {
			log.report(builds, home);
			return errors.length > 0
				? err(new ReportedError(new DiagnosticsError(errors)))
				: ok(undefined);
		}

		private reportAsJson(
			logService: LogService,
			builds: readonly ConfigBuild[],
			errors: readonly Diagnostic[]
		): Result<void, Error> {
			const report = new BuildReport();
			for (const build of builds) report.add(build);

			return this.printJson(
				logService,
				report.json(),
				errors.length > 0 ? new DiagnosticsError(errors) : undefined
			);
		}
	}
);
