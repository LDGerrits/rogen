import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { relativeTo } from "../../base/path.js";
import {
	ConfigArguments,
	ConfigEntry,
	ConfigService,
} from "../../domain/config/config-service.js";
import { CONFIG_FILE_NAMES } from "../../domain/config/config.js";
import { projectsOf } from "../../domain/config/resolved-config.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { CommandLine } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";

registerCommand(
	class FmtProjectCommand extends AbstractCommand {
		constructor() {
			super({
				id: "fmt-project",
				metadata: {
					description:
						"Formats rogen.json as 'rojo fmt-project' formats a project file, Rojo's keys first and Rogen's after. A file with comments is left alone.",
					args: ConfigArguments,
					examples: [
						"rogen fmt-project",
						"rogen fmt-project places/lobby",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<readonly []>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const fileSystemService = accessor.get(FileSystemService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const configService = accessor.get(ConfigService);
			const selection = await configService.select(line.positionals);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);

			const failures = [];
			for (const file of await this.filesOf(
				selection.value.entries,
				fileSystemService
			)) {
				const formatted = await configService.format(file);
				if (formatted.isErr()) failures.push(...formatted.error);
				else if (formatted.value)
					logService.print(`formatted ${relativeTo(cwd, file)}`);
			}
			const failure = DiagnosticsError.of(failures);
			return failure ? err(failure) : ok(undefined);
		}

		private async filesOf(
			entries: readonly ConfigEntry[],
			fileSystemService: FileSystemService
		): Promise<string[]> {
			const files = new Set(
				entries.flatMap((entry) => {
					if (entry.status === "valid")
						return projectsOf(entry, entry.scope).map(
							({ file }) => file
						);
					return entry.scope
						? entry.scope.flatMap((folder) =>
								CONFIG_FILE_NAMES.map((name) =>
									path.join(folder, name)
								)
							)
						: [entry.file];
				})
			);
			const found = [];
			for (const file of files)
				if (await fileSystemService.exists(file)) found.push(file);
			return found;
		}
	}
);
