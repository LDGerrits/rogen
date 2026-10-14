import { relativeTo } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import { BuildService } from "../../domain/build/build-service.js";

import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	renderDiagnostic,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	diagnosticShape,
	diagnosticToJson,
	diagnosticsJson,
} from "../../platform/diagnostics/diagnostic-json.js";
import { OutputShape } from "../../platform/output/output-shape.js";

const CheckOptions = [JsonOption] as const;

const CheckOutput = OutputShape.object({
	diagnostics: OutputShape.array(diagnosticShape),
	stoppedBy: OutputShape.optional(OutputShape.array(diagnosticShape)),
});

registerCommand(
	class CheckCommand extends AbstractCommand<typeof CheckOptions> {
		constructor() {
			super({
				id: "check",
				metadata: {
					summary:
						"Prints the diagnostics, and exits 1 when there are any",
					description:
						"Prints the diagnostics about the given paths, or about the whole project, and exits 1 when there are any.",
					args: [
						{
							name: "path",
							description:
								"A file, or a directory for the files in it; a file that doesn't exist yet is checked as if it did. A :line or :line:col after a file, as a linter prints it, is ignored. The whole project, sync path warnings included, when none is given. The config here, or in the nearest folder above that has one, is read.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: CheckOptions,
					output: { document: CheckOutput },
					effects: [],
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

			const selection = await configService.select([]);
			if (selection.isErr()) return selection;
			const found = await buildService.diagnose(
				selection.value,
				line.positionals.length > 0
					? { args: line.positionals, cwd }
					: undefined
			);
			if (found.isErr()) return found;

			const failure = DiagnosticsError.of(found.value.diagnostics);
			const stoppedBy = uniqueDiagnostics(found.value.stoppedBy);
			if (line.options.json)
				return this.printJson(
					logService,
					{
						...diagnosticsJson(failure?.diagnostics ?? []),
						...(stoppedBy.length > 0 && {
							stoppedBy: stoppedBy.map(diagnosticToJson),
						}),
					},
					failure
				);
			for (const diagnostic of failure?.diagnostics ?? []) {
				logService.print(renderDiagnostic(diagnostic, cwd));
				logService.annotate(diagnostic);
			}
			if (stoppedBy.length > 0)
				logService.warn(
					`Checked as far as the build gets: it stops on ${joinedWithAnd(stoppedBy.map(({ resource, code }) => `${relativeTo(cwd, resource)} (${code})`))}. Run 'rogen check' to see everything.`
				);
			return failure ? this.reported(failure) : ok(undefined);
		}
	}
);
