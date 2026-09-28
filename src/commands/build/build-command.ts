import path from "path";
import { err, ok } from "../../base/result.js";
import { readFolderMeta } from "../../domain/build/read-folder-meta.js";
import {
	BuildSummary,
	build,
	checkRoutes,
	rootsToIndex,
} from "../../domain/build/build.js";
import { describeBuild } from "../../domain/build/describe-build.js";
import { describeConfig } from "../../domain/config/describe-config.js";
import { checkSyncDir } from "../../domain/output/check-sync-dir.js";
import { checkSyncMeta } from "../../domain/output/check-sync-meta.js";
import { findOutputClashes } from "../../domain/output/find-output-clashes.js";
import { writeOutput } from "../../domain/output/write-output.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { RojoTree } from "../../domain/rojo/rojo-tree.js";
import { showConfig } from "./show-config.js";
import { ConfigOptions } from "../config-options.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	ConfigEntry,
	ConfigService,
} from "../../domain/config/config-service.js";
import {
	configLabel,
	unrequestedConfigNotice,
} from "../../domain/config/config-discovery.js";
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

function logDiagnostics(
	logService: LogService,
	diagnostics: readonly Diagnostic[]
): void {
	for (const diagnostic of diagnostics) logService.diagnostic(diagnostic);
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

		const valid = requireValidConfigs(configService);
		if (valid.isErr()) return valid;

		const loaded = configService.configs.flatMap((entry) =>
			entry.resolved
				? [{ entry, config: { file: entry.file, ...entry.resolved } }]
				: []
		);
		const entries = loaded.map(({ config }) => config);
		const notice = await unrequestedConfigNotice(
			fileSystemService,
			environmentService.cwd,
			configService.configs.map((entry) => entry.file)
		);

		const upfront = [
			...checkRoutes(entries),
			...findOutputClashes(entries),
		];
		if (upfront.length > 0) return err(new DiagnosticsError(upfront));

		logService.intro(
			`rogen build · ${entries.map(({ file }) => configLabel(file)).join(", ")}`
		);
		if (notice) logService.info(notice);

		await indexService.initialize(rootsToIndex(entries));

		const built: {
			entry: ConfigEntry;
			config: (typeof entries)[number];
			tree: RojoTree;
			warnings: readonly Diagnostic[];
			summary: BuildSummary;
		}[] = [];
		const errors: Diagnostic[] = [];
		for (const { entry, config } of loaded) {
			const folderMeta = await readFolderMeta(
				fileSystemService,
				indexService,
				config
			);
			const result = folderMeta.isOk()
				? build(config, indexService, folderMeta.value)
				: folderMeta;
			if (result.isErr()) {
				errors.push(...result.error);
				continue;
			}
			built.push({
				entry,
				config,
				tree: result.value.value,
				warnings: result.value.warnings,
				summary: result.value.summary,
			});
		}
		if (errors.length > 0) {
			for (const { warnings } of built)
				logDiagnostics(logService, warnings);
			return err(new DiagnosticsError(errors));
		}

		for (const { entry, config, tree, warnings, summary } of built) {
			if (built.length > 1) logService.step(configLabel(config.file));
			const written = await writeOutput(fileSystemService, config, tree);
			if (written.isErr())
				return err(new DiagnosticsError(written.error));

			const outFile =
				path.relative(environmentService.cwd, config.outFile) || ".";
			logService.success(
				`${outFile} · ${written.value.value.written ? "wrote" : "unchanged"}`
			);
			for (const line of [
				...describeConfig(entry, environmentService.cwd),
				...describeBuild(summary, environmentService.cwd),
			])
				logService.debug(line);
			logDiagnostics(logService, [
				...warnings,
				...written.value.warnings,
				...(await checkSyncDir(fileSystemService, config)),
				...(await checkSyncMeta(
					fileSystemService,
					indexService,
					config
				)),
			]);
		}

		logService.outro(
			`Built ${built.length} ${built.length === 1 ? "config" : "configs"}.`
		);
		return ok(undefined);
	},
});
