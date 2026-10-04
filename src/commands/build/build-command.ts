import { ReportedError } from "../../base/errors.js";
import { formatJsonDocument } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import { ConfigBuild } from "../../domain/build/build.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	ConfigOptions,
	JsonOption,
	ParsedArgs,
} from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "./build-log.js";
import { BuildReport } from "./build-report.js";

/** What a config's build warned about; its errors are the run's to report. */
function warningsOf({
	warnings,
	syncWarnings,
}: ConfigBuild): readonly Diagnostic[] {
	return [...warnings, ...syncWarnings];
}

registerCommand(
	class BuildCommand extends AbstractCommand {
		constructor() {
			super({
				id: "build",
				metadata: {
					description: "Writes each named config's project file.",
					args: [
						{
							name: "name",
							description: "A config to build.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: [...ConfigOptions, JsonOption],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			args: ParsedArgs
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const logService = accessor.get(LogService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const selection = await configService.select(args);
			if (selection.isErr()) return selection;

			const builds = await buildService.build(selection.value, {
				checkSyncDir: true,
			});
			if (builds.isErr()) return builds;

			const errors = builds.value.flatMap((build) => build.errors);
			const { unselected } = selection.value;
			return args.json
				? this.reportAsJson(
						logService,
						builds.value,
						errors,
						unselected
					)
				: this.report(
						new BuildLog(logService, cwd),
						builds.value,
						errors,
						unselected
					);
		}

		private report(
			log: BuildLog,
			builds: readonly ConfigBuild[],
			errors: readonly Diagnostic[],
			unselected: readonly string[]
		): Result<void, Error> {
			log.begin(
				"build",
				builds.map(({ config }) => config),
				unselected
			);

			for (const build of builds) {
				if (builds.length > 1) log.heading(build.config);
				log.outcome(build, warningsOf(build));
			}
			if (errors.length > 0) return err(new DiagnosticsError(errors));

			log.end(builds.length);
			return ok(undefined);
		}

		private reportAsJson(
			logService: LogService,
			builds: readonly ConfigBuild[],
			errors: readonly Diagnostic[],
			unselected: readonly string[]
		): Result<void, Error> {
			const report = new BuildReport();
			for (const build of builds) report.add(build);

			logService.print(formatJsonDocument(report.json(unselected)));
			return errors.length > 0
				? err(new ReportedError(new DiagnosticsError(errors)))
				: ok(undefined);
		}
	}
);
