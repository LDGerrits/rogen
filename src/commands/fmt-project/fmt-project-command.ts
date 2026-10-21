import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { relativeTo, toNative } from "../../base/path.js";
import {
	ConfigArguments,
	ConfigEntry,
	ConfigService,
} from "../../domain/config/config-service.js";
import { CONFIG_FILE_NAMES } from "../../domain/config/config.js";
import { configsOf } from "../../domain/config/resolved-config.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import {
	DiagnosticJson,
	diagnosticShape,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic-json.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";

const FmtProjectOptions = [JsonOption] as const;

const FmtProjectOutput = OutputShape.object({
	changed: OutputShape.boolean,
	files: OutputShape.array(
		OutputShape.object({
			file: OutputShape.string,
			outcome: OutputShape.enum("wrote", "unchanged", "failed"),
			diagnostics: OutputShape.array(diagnosticShape),
		})
	),
});

interface FormattedFile {
	readonly file: string;
	readonly outcome: "wrote" | "unchanged" | "failed";
	readonly diagnostics: readonly DiagnosticJson[];
}

function formattedFile(
	file: string,
	formatted: Result<boolean, Diagnostic[]>
): FormattedFile {
	return {
		file: toNative(file),
		outcome: formatted.isErr()
			? "failed"
			: formatted.value
				? "wrote"
				: "unchanged",
		diagnostics: formatted.isErr()
			? formatted.error.map(diagnosticToJson)
			: [],
	};
}

registerCommand(
	class FmtProjectCommand extends AbstractCommand<typeof FmtProjectOptions> {
		constructor() {
			super({
				id: "fmt-project",
				metadata: {
					summary:
						"Formats rogen.json the way 'rojo fmt-project' does",
					description:
						"Formats rogen.json as 'rojo fmt-project' formats a project file, Rojo's keys first and Rogen's after. A file with comments is left alone.",
					args: ConfigArguments,
					options: FmtProjectOptions,
					output: { document: FmtProjectOutput },
					effects: ["writesFiles"],
					examples: [
						"rogen fmt-project",
						"rogen fmt-project places/lobby",
						"rogen fmt-project --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof FmtProjectOptions>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const fileSystemService = accessor.get(FileSystemService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const configService = accessor.get(ConfigService);
			const selection = await configService.select(line.positionals);
			if (selection.isErr()) return selection;

			const files: FormattedFile[] = [];
			const failures: Diagnostic[] = [];
			for (const file of await this.filesOf(
				selection.value.entries,
				fileSystemService
			)) {
				const formatted = await configService.format(file);
				if (formatted.isErr()) failures.push(...formatted.error);
				const entry = formattedFile(file, formatted);
				files.push(entry);
				if (!line.options.json && entry.outcome === "wrote")
					logService.print(`formatted ${relativeTo(cwd, file)}`);
			}
			const failure = DiagnosticsError.of(failures);
			if (line.options.json)
				return this.printJson(
					logService,
					{
						changed: files.some(
							({ outcome }) => outcome === "wrote"
						),
						files,
					},
					failure
				);
			return failure ? err(failure) : ok(undefined);
		}

		private async filesOf(
			entries: readonly ConfigEntry[],
			fileSystemService: FileSystemService
		): Promise<string[]> {
			const files = new Set(
				entries.flatMap((entry) => {
					if (entry.status === "valid")
						return configsOf(entry, entry.scope).map(
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
