import { err, ok } from "../../base/result.js";
import {
	BuildService,
	BuiltProject,
} from "../../domain/build/build-service.js";
import { configLabel } from "../../domain/config/config-discovery.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { entryErrors } from "../../domain/config/valid-configs.js";
import { writeOutput } from "../../domain/output/write-output.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { ConfigOptions } from "../config-options.js";
import { BuildTarget, beginBuild } from "./begin-build.js";
import { logWritten } from "./log-build.js";
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
		const fileSystemService = accessor.get(FileSystemService);
		const environmentService = accessor.get(EnvironmentService);
		const buildService = accessor.get(BuildService);
		const logDiagnostics = (diagnostics: readonly Diagnostic[]) => {
			for (const diagnostic of diagnostics)
				logService.diagnostic(diagnostic);
		};

		if (args["show-config"]) {
			logService.print(showConfig(configService.configs));
			const broken = configService.configs.filter(
				(entry) => entryErrors(entry).length > 0
			);
			return broken.length > 0
				? err(
						new Error(
							`${broken.length} of ${configService.configs.length} configs have errors.`
						)
					)
				: ok(undefined);
		}

		const cwd = environmentService.cwd;
		const began = await beginBuild({
			configService,
			buildService,
			fileSystemService,
			logService,
			cwd,
			command: "build",
		});
		if (began.isErr()) return began;
		const targets = began.value;

		// Every config builds before any is written, so a failure writes nothing.
		const built: (BuildTarget & { project: BuiltProject })[] = [];
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
			if (built.length > 1) logService.step(configLabel(config.file));
			const written = await writeOutput(
				fileSystemService,
				config,
				project.tree
			);
			if (written.isErr())
				return err(new DiagnosticsError(written.error));

			logWritten(
				logService,
				cwd,
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
