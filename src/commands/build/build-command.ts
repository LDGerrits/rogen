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
			const unselected = await configService.listUnselectedConfigFiles();
			return args.json
				? this.reportAsJson(accessor, attempts, unselected)
				: this.report(accessor, attempts, unselected);
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

		private async report(
			accessor: ServicesAccessor,
			attempts: readonly BuildAttempt[],
			unselected: readonly string[]
		): Promise<Result<void, Error>> {
			const buildService = accessor.get(BuildService);
			const log = new BuildLog(
				accessor.get(LogService),
				accessor.get(EnvironmentService).cwd
			);
			log.begin("build", attempts, unselected);

			const errors = attempts.flatMap(({ project }) =>
				project.isErr() ? project.error.diagnostics : []
			);
			if (errors.length > 0) {
				for (const { project } of attempts)
					if (project.isOk()) log.diagnostics(project.value.warnings);
				return err(new DiagnosticsError(errors));
			}

			for (const attempt of attempts) {
				const project = attempt.project.unwrap();
				if (attempts.length > 1) log.heading(attempt);
				const written = await buildService.write(project);
				if (written.isErr()) return written;
				log.written(
					attempt,
					written.value.written,
					project.summary,
					diagnosticsOf(attempt)
				);
			}

			log.end(attempts.length);
			return ok(undefined);
		}

		private async reportAsJson(
			accessor: ServicesAccessor,
			attempts: readonly BuildAttempt[],
			unselected: readonly string[]
		): Promise<Result<void, Error>> {
			const buildService = accessor.get(BuildService);
			const report = new BuildReport();
			const errors = attempts.flatMap(({ project }) =>
				project.isErr() ? project.error.diagnostics : []
			);

			for (const attempt of attempts) {
				const { config, project } = attempt;
				if (errors.length > 0 || project.isErr()) {
					report.add(config, "notWritten", diagnosticsOf(attempt));
					continue;
				}
				const written = await buildService.write(project.value);
				if (written.isErr()) return written;
				report.add(
					config,
					written.value.written ? "wrote" : "unchanged",
					diagnosticsOf(attempt)
				);
			}

			accessor
				.get(LogService)
				.print(JSON.stringify(report.json(unselected), null, 2));
			return errors.length > 0
				? err(new ReportedError(new DiagnosticsError(errors)))
				: ok(undefined);
		}
	}
);
