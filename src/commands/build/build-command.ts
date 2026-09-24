import path from "path";
import { err, ok } from "../../base/result.js";
import { build, checkRoutes, rootsToIndex } from "../../domain/build/build.js";
import { checkSyncDir } from "../../domain/output/check-sync-dir.js";
import { findOutputClashes } from "../../domain/output/find-output-clashes.js";
import { writeOutput } from "../../domain/output/write-output.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { renderDiagnostic } from "../../platform/diagnostics/render-diagnostic.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { showConfig } from "./show-config.js";
import { ConfigOptions } from "../config-options.js";
import { LogService } from "../../platform/log/log-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { unrequestedConfigNotice } from "../../domain/config/config-discovery.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import {
	entryErrors,
	requireValidConfigs,
} from "../../domain/config/valid-configs.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";

function logWarnings(
	logService: LogService,
	warnings: readonly Diagnostic[]
): void {
	for (const warning of warnings) logService.warn(renderDiagnostic(warning));
}

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
		const indexService = accessor.get(IndexService);

		if (args["show-config"]) {
			logService.info(showConfig(configService.configs));
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

		const configs = requireValidConfigs(configService);
		if (configs.isErr()) return configs;

		const notice = await unrequestedConfigNotice(
			fileSystemService,
			environmentService.cwd,
			configService.configs.map((entry) => entry.file)
		);
		if (notice) logService.info(notice);

		const entries = configService.configs.flatMap((entry) =>
			entry.resolved ? [{ file: entry.file, ...entry.resolved }] : []
		);
		const upfront = [
			...checkRoutes(entries),
			...findOutputClashes(entries),
		];
		if (upfront.length > 0) return err(new DiagnosticsError(upfront));

		await indexService.initialize(rootsToIndex(configs.value));

		const built = [];
		const errors: Diagnostic[] = [];
		for (const config of configs.value) {
			const result = build(config, indexService);
			if (result.isErr()) {
				errors.push(...result.error);
				continue;
			}
			built.push({ config, tree: result.value.value });
			logWarnings(logService, result.value.warnings);
		}
		if (errors.length > 0) return err(new DiagnosticsError(errors));

		for (const { config, tree } of built) {
			const written = await writeOutput(fileSystemService, config, tree);
			if (written.isErr())
				return err(new DiagnosticsError(written.error));

			const outFile =
				path.relative(environmentService.cwd, config.outFile) || ".";
			logService.info(
				written.value.value.written
					? `Wrote ${outFile}.`
					: `${outFile} is up to date.`
			);
			logWarnings(logService, [
				...written.value.warnings,
				...(await checkSyncDir(fileSystemService, config)),
			]);
		}

		return ok(undefined);
	},
});
