import { Result, ok } from "../../base/result.js";
import { defanged } from "../../base/strings.js";
import {
	WriteService,
	skippedNotes,
} from "../../domain/write/write-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { renderDiagnostic } from "../../platform/diagnostics/diagnostic.js";
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
import {
	skippedJson,
	skippedPathShape,
} from "../../platform/diagnostics/skipped-path.js";
import { OutputShape } from "../../platform/output/output-shape.js";

const CheckOptions = [JsonOption] as const;

const ASKING = { command: "check", lead: "Check it" };

const CheckOutput = OutputShape.object({
	diagnostics: OutputShape.array(diagnosticShape),
	stoppedBy: OutputShape.optional(OutputShape.array(diagnosticShape)),
	skipped: OutputShape.optional(OutputShape.array(skippedPathShape)),
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
						"Prints the diagnostics about the given paths, or about every config of the working directory, and exits 1 when there are any.",
					args: [
						{
							name: "path",
							description: [
								"A file or a directory. A directory gives the files in it, and a file that doesn't exist yet is checked as if it did. A :line or :line:col after a file is ignored.",
								"- Config: the default config of the nearest folder at or above the path; with none, every .rogen.json at or above it whose source paths cover it. Naming a .rogen.json, or a config as build reads it (game for game.rogen.json), checks that config whole.",
								"- Findings: those of a whole check that are about the path, a folder it is in or a folder in it, and those about the config itself, such as an out-of-date project file or the compiled path. An error elsewhere that stops the write is listed under stoppedBy, and fails the check.",
								"- Skipped: a path Rogen leaves out, in no source path of its config or covered by no config, gets a note on stderr and is listed under skipped in the JSON document.",
								"- No path: every .rogen.json of the working directory, whole; with none, the plain project file there.",
							].join("\n"),
							isOptional: true,
							isVariadic: true,
						},
					],
					options: CheckOptions,
					output: { document: CheckOutput },
					effects: [],
					exitCodes: {
						"0": "no diagnostics",
						"1": "any diagnostic, a warning included, or an out-of-date project file of a config it checks",
					},
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
			const cwd = accessor.get(EnvironmentService).cwd;
			const logService = accessor.get(LogService);
			const found = await accessor
				.get(WriteService)
				.diagnose({ args: line.positionals, cwd });
			if (found.isErr()) return found;

			const { diagnostics, stoppedBy, skipped } = found.value;
			for (const note of skippedNotes(found.value, cwd, ASKING))
				logService.notice(note);

			const failsCheck = DiagnosticsError.of(found.value.failing);
			if (line.options.json)
				return this.printJson(
					logService,
					{
						...diagnosticsJson(diagnostics, cwd),
						...(stoppedBy.length > 0 && {
							stoppedBy: stoppedBy.map((diagnostic) =>
								diagnosticToJson(diagnostic, cwd)
							),
						}),
						...skippedJson(skipped, cwd),
					},
					failsCheck
				);
			for (const diagnostic of failsCheck?.diagnostics ?? []) {
				logService.print(defanged(renderDiagnostic(diagnostic, cwd)));
				logService.annotate(diagnostic);
			}
			if (stoppedBy.length > 0)
				logService.warn(
					`The write stops on the ${stoppedBy.length === 1 ? "error" : "errors"} above, so the paths were checked only as far as it gets; fix ${stoppedBy.length === 1 ? "it" : "them"} and check again.`
				);
			return failsCheck ? this.reported(failsCheck) : ok(undefined);
		}
	}
);
