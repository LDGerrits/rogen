import path from "path";
import { formatJsonDocument } from "../../base/json.js";
import { Result, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { InstanceReference } from "../../domain/roblox/roblox.js";
import {
	ConfigService,
	configRefsFromArgs,
	requireValidEntries,
} from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	ConfigSelectionOptions,
	JsonOption,
	ParsedArgs,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { LocationReport } from "./location-report.js";

registerCommand(
	class WhereCommand extends AbstractCommand {
		constructor() {
			super({
				id: "where",
				metadata: {
					description:
						"Prints where each file lands in the game, and why.",
					args: [
						{
							name: "path",
							description:
								"A file, or a directory for the files in it; a file that doesn't exist yet is placed as if it did. An instance as Studio prints it (ServerScriptService.Inventory.Save:12) gives the files behind it. Every file when none is given.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: [...ConfigSelectionOptions, JsonOption],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			args: ParsedArgs
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const logService = accessor.get(LogService);

			// The positionals are paths, so only the flags pick configs.
			const loaded = await configService.initialize(
				configRefsFromArgs(args, [])
			);
			if (loaded.isErr()) return loaded;
			const targets = requireValidEntries(configService.configs);
			if (targets.isErr()) return targets;

			const given = args._.slice(1);
			const { paths, instances } = await this.readTargets(
				accessor.get(FileSystemService),
				cwd,
				given
			);
			const report = new LocationReport(cwd);
			for (const { config } of targets.value) {
				const located =
					paths.length > 0 || instances.length === 0
						? await buildService.locate(
								config,
								paths.length > 0 ? paths : undefined
							)
						: ok([]);
				if (located.isErr()) return located;
				const behind = await buildService.locateInstances(
					config,
					instances
				);
				if (behind.isErr()) return behind;
				report.add(config.label, located.value, behind.value);
			}

			if (args.json) {
				logService.print(
					formatJsonDocument(report.json(given.length === 0))
				);
				return ok(undefined);
			}
			const lines = report.lines(given.length === 0);
			if (lines.length > 0) logService.print(lines.join("\n"));
			return ok(undefined);
		}

		/** An argument that starts with a service is an instance, unless the working directory holds an entry of that name. */
		private async readTargets(
			fileSystem: FileSystemService,
			cwd: string,
			given: readonly string[]
		): Promise<{ paths: string[]; instances: InstanceReference[] }> {
			const paths: string[] = [];
			const instances: InstanceReference[] = [];
			for (const arg of given) {
				const reference = InstanceReference.parse(arg);
				if (
					reference &&
					!(await fileSystem.exists(path.resolve(cwd, reference.service)))
				)
					instances.push(reference);
				else paths.push(path.resolve(cwd, arg));
			}
			return { paths, instances };
		}
	}
);
