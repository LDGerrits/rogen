import { err, ok } from "../../base/result.js";
import {
	BuildService,
	BuiltProject,
} from "../../domain/build/build-service.js";
import {
	ConfigService,
	ResolvedEntry,
} from "../../domain/config/config-service.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { ConfigOptions } from "../config-options.js";
import { BuildLog } from "./build-log.js";
import { showConfig } from "./show-config.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "build",
	metadata: {
		requiresConfig: true,
		description: "Writes each named config's project file.",
		args: [
			{
				name: "name",
				description: "A config to build.",
				isOptional: true,
				isVariadic: true,
				namesConfig: true,
			},
		],
		options: [
			...ConfigOptions,
			{
				name: "show-config",
				type: "boolean",
				description: "Prints the resolved config and exits.",
			},
		],
	},
	handler: async (accessor, args) => {
		const logService = accessor.get(LogService);
		const configService = accessor.get(ConfigService);
		const environmentService = accessor.get(EnvironmentService);
		const buildService = accessor.get(BuildService);
		const logDiagnostics = (diagnostics: readonly Diagnostic[]) => {
			for (const diagnostic of diagnostics)
				logService.diagnostic(diagnostic);
		};

		if (args["show-config"]) {
			logService.print(showConfig(configService.configs));
			const broken = configService.getBrokenError();
			return broken ? err(broken) : ok(undefined);
		}

		const valid = configService.requireValidEntries();
		if (valid.isErr()) return valid;
		const targets = valid.value;
		const buildable = buildService.checkBuildable(
			targets.map(({ config }) => config)
		);
		if (buildable.isErr()) return buildable;
		const buildLog = new BuildLog(logService, environmentService.cwd);
		buildLog.begin(
			"build",
			targets,
			await configService.listUnselectedConfigFiles()
		);

		// Every config builds before any is written, so a failure writes nothing.
		const built: (ResolvedEntry & { project: BuiltProject })[] = [];
		const errors: Diagnostic[] = [];
		for (const target of targets) {
			const project = await buildService.build(target.config, {
				checkSyncDir: true,
			});
			if (project.isErr()) errors.push(...project.error);
			else built.push({ ...target, project: project.value });
		}
		if (errors.length > 0) {
			for (const { project } of built) logDiagnostics(project.warnings);
			return err(new DiagnosticsError(errors));
		}

		for (const { entry, config, project } of built) {
			if (built.length > 1) logService.step(config.label);
			const written = await buildService.write(project);
			if (written.isErr())
				return err(new DiagnosticsError(written.error));

			buildLog.written(
				{ entry, config },
				written.value.written,
				project.summary
			);
			logDiagnostics([...project.warnings, ...project.syncWarnings]);
		}

		logService.outro(
			`Built ${built.length} ${built.length === 1 ? "config" : "configs"}.`
		);
		return ok(undefined);
	},
});
