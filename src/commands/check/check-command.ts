import { ReportedError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigSelectionOptions } from "../../domain/config/config.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	diagnosticsJson,
	renderDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";

const CheckOptions = [...ConfigSelectionOptions, JsonOption] as const;

registerCommand(
	class CheckCommand extends AbstractCommand<typeof CheckOptions> {
		constructor() {
			super({
				id: "check",
				metadata: {
					description:
						"Prints the diagnostics about the given paths, or about the whole project, and exits 1 when there are any.",
					args: [
						{
							name: "path",
							description:
								"A file, or a directory for the files in it; a file that doesn't exist yet is checked as if it did. A :line or :line:col after a file, as a linter prints it, is ignored. The whole project, sync dir warnings included, when none is given. Every config here, or in the nearest folder above that has any, is read.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: CheckOptions,
					examples: [
						"rogen check src/Inventory/Server/Save.luau",
						"rogen check src --json",
						"rogen check",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof CheckOptions>
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const logService = accessor.get(LogService);

			// The positionals are paths, so every config here is read.
			const selection = await configService.select([], line.options);
			if (selection.isErr()) return selection;
			const found = await buildService.diagnose(
				selection.value,
				line.positionals.length > 0
					? { args: line.positionals, cwd }
					: undefined
			);
			if (found.isErr()) return found;

			const failure = DiagnosticsError.of(found.value);
			if (line.options.json)
				return this.printJson(
					logService,
					diagnosticsJson(failure?.diagnostics ?? []),
					failure
				);
			if (!failure) return ok(undefined);
			// The findings are what was asked for, so they go to stdout and survive --quiet.
			for (const diagnostic of failure.diagnostics)
				logService.print(renderDiagnostic(diagnostic, cwd));
			return err(new ReportedError(failure));
		}
	}
);
