import { ReportedError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	BuildService,
	BuiltProject,
} from "../../domain/build/build-service.js";
import {
	ConfigService,
	ResolvedEntry,
	configRefsFromArgs,
} from "../../domain/config/config-service.js";
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

interface BuildAttempt extends ResolvedEntry {
	readonly project: Result<BuiltProject, DiagnosticsError>;
}

/** What a config's build had to say, for the run to report. */
function diagnosticsOf({ project }: BuildAttempt): readonly Diagnostic[] {
	return project.isErr()
		? project.error.diagnostics
		: [...project.value.warnings, ...project.value.syncWarnings];
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

			const loaded = await configService.initialize(
				configRefsFromArgs(args, args._.slice(1))
			);
			if (loaded.isErr()) return loaded;

			const targets = configService.requireValidEntries();
			if (targets.isErr()) return targets;
			const buildable = buildService.checkBuildable(
				targets.value.map(({ config }) => config)
			);
			if (buildable.isErr()) return buildable;

			const attempts = await this.buildAll(buildService, targets.value);
			const errors = attempts.flatMap(({ project }) =>
				project.isErr() ? project.error.diagnostics : []
			);
			const unselected = await configService.listUnselectedConfigFiles();
			return args.json
				? this.reportAsJson(
						buildService,
						logService,
						attempts,
						errors,
						unselected
					)
				: this.report(
						buildService,
						new BuildLog(logService, cwd),
						attempts,
						errors,
						unselected
					);
		}

		/** Every config builds before any is written, so a failure writes nothing. */
		private async buildAll(
			buildService: BuildService,
			targets: readonly ResolvedEntry[]
		): Promise<BuildAttempt[]> {
			const attempts: BuildAttempt[] = [];
			for (const target of targets) {
				attempts.push({
					...target,
					project: await buildService.build(target.config, {
						checkSyncDir: true,
					}),
				});
			}
			return attempts;
		}

		/** Writes each project in turn and says how it went, stopping at the first failure. */
		private async writeAll(
			buildService: BuildService,
			attempts: readonly BuildAttempt[],
			written: (attempt: BuildAttempt, changed: boolean) => void
		): Promise<Result<void, Error>> {
			for (const attempt of attempts) {
				const result = await buildService.write(
					attempt.project.unwrap()
				);
				if (result.isErr()) return result;
				written(attempt, result.value.written);
			}
			return ok(undefined);
		}

		private async report(
			buildService: BuildService,
			log: BuildLog,
			attempts: readonly BuildAttempt[],
			errors: readonly Diagnostic[],
			unselected: readonly string[]
		): Promise<Result<void, Error>> {
			log.begin("build", attempts, unselected);

			if (errors.length > 0) {
				for (const { project } of attempts)
					if (project.isOk()) log.diagnostics(project.value.warnings);
				return err(new DiagnosticsError(errors));
			}

			const written = await this.writeAll(
				buildService,
				attempts,
				(attempt, changed) => {
					if (attempts.length > 1) log.heading(attempt);
					log.written(
						attempt,
						changed,
						attempt.project.unwrap().summary,
						diagnosticsOf(attempt)
					);
				}
			);
			if (written.isErr()) return written;

			log.end(attempts.length);
			return ok(undefined);
		}

		private async reportAsJson(
			buildService: BuildService,
			logService: LogService,
			attempts: readonly BuildAttempt[],
			errors: readonly Diagnostic[],
			unselected: readonly string[]
		): Promise<Result<void, Error>> {
			const report = new BuildReport();

			if (errors.length > 0) {
				for (const attempt of attempts)
					report.add(
						attempt.config,
						"notWritten",
						diagnosticsOf(attempt)
					);
			} else {
				const written = await this.writeAll(
					buildService,
					attempts,
					(attempt, changed) =>
						report.add(
							attempt.config,
							changed ? "wrote" : "unchanged",
							diagnosticsOf(attempt)
						)
				);
				if (written.isErr()) return written;
			}

			logService.print(JSON.stringify(report.json(unselected), null, 2));
			return errors.length > 0
				? err(new ReportedError(new DiagnosticsError(errors)))
				: ok(undefined);
		}
	}
);
