import path from "path";
import { Result, err, ok } from "../../base/result.js";
import {
	BuildService,
	BuiltProject,
} from "../../domain/build/build-service.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import {
	ConfigEntry,
	ConfigService,
	ResolvedEntry,
} from "../../domain/config/config-service.js";
import { registerCommand } from "../../platform/commands/commands.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { renderDiagnostic } from "../../platform/diagnostics/render-diagnostic.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ParsedArgs } from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	AbstractConfigCommand,
	ConfigOptions,
} from "../config/config-command.js";
import { BuildLog } from "./build-log.js";

interface BuiltTarget extends ResolvedEntry {
	readonly project: BuiltProject;
}

function describeConfig(config: ResolvedConfig): Record<string, unknown> {
	return {
		name: config.name,
		rootDirs: config.rootDirs,
		commonRoot: config.commonRoot ?? null,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, target.toString()])
		),
		tags: config.tags,
		exclude: config.exclude,
		template: config.template?.file ?? null,
		syncDir: config.syncDir ?? null,
		outFile: config.outFile,
	};
}

/** Strict JSON: the entry itself for one config, else an object keyed by config file. */
function configsAsJson(entries: readonly ConfigEntry[]): string {
	const described = entries.map((entry): [string, unknown] => [
		path.basename(entry.file),
		entry.resolved
			? describeConfig(entry.resolved)
			: {
					diagnostics: entry.errors.map((diagnostic) =>
						renderDiagnostic(diagnostic)
					),
				},
	]);
	const value =
		described.length === 1
			? described[0][1]
			: Object.fromEntries(described);
	return JSON.stringify(value, null, 2);
}

registerCommand(
	class BuildCommand extends AbstractConfigCommand {
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
					options: [
						...ConfigOptions,
						{
							name: "show-config",
							type: "boolean",
							description:
								"Prints the resolved config and exits.",
						},
					],
				},
			});
		}

		protected async runWithConfigs(
			accessor: ServicesAccessor,
			args: ParsedArgs
		): Promise<Result<void, Error>> {
			return args["show-config"]
				? this.showConfig(accessor)
				: this.build(accessor);
		}

		private async showConfig(
			accessor: ServicesAccessor
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			accessor
				.get(LogService)
				.print(configsAsJson(configService.configs));
			const broken = configService.getBrokenError();
			return broken ? err(broken) : ok(undefined);
		}

		/** Every config builds before any is written, so a failure writes nothing. */
		private async build(
			accessor: ServicesAccessor
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const log = new BuildLog(
				accessor.get(LogService),
				accessor.get(EnvironmentService).cwd
			);

			const targets = configService.requireValidEntries();
			if (targets.isErr()) return targets;
			const buildable = buildService.checkBuildable(
				targets.value.map(({ config }) => config)
			);
			if (buildable.isErr()) return buildable;
			log.begin(
				"build",
				targets.value,
				await configService.listUnselectedConfigFiles()
			);

			const built: BuiltTarget[] = [];
			const errors: Diagnostic[] = [];
			for (const target of targets.value) {
				const project = await buildService.build(target.config, {
					checkSyncDir: true,
				});
				if (project.isErr()) errors.push(...project.error.diagnostics);
				else built.push({ ...target, project: project.value });
			}
			if (errors.length > 0) {
				for (const { project } of built)
					log.diagnostics(project.warnings);
				return err(new DiagnosticsError(errors));
			}

			for (const target of built) {
				if (built.length > 1) log.heading(target);
				const written = await buildService.write(target.project);
				if (written.isErr()) return written;
				const { summary, warnings, syncWarnings } = target.project;
				log.written(target, written.value.written, summary, [
					...warnings,
					...syncWarnings,
				]);
			}

			log.end(built.length);
			return ok(undefined);
		}
	}
);
