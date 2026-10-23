import path from "path";
import { relativeTo, samePath } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	WriteService,
	Diagnosis,
	mergeDiagnoses,
	uniqueSkipped,
} from "../../domain/write/write-service.js";

import { AskedPaths, skippedNotes } from "../../domain/write/asked-paths.js";
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
								"- Skipped: a path no build reads, in no source path of its config or covered by no config, gets a note on stderr and is listed under skipped in the JSON document.",
								"- No path: every .rogen.json of the working directory, whole, compiled path warnings included; with none, the plain project file there.",
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
						"1": "any diagnostic, a warning included; with no path, the project file of any config that is out of date counts too",
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

			const found = await this.diagnose(accessor, line.positionals);
			if (found.isErr()) return found;

			const { skipped } = found.value;
			for (const note of await skippedNotes(
				accessor.get(ConfigService),
				skipped,
				cwd,
				ASKING
			))
				logService.notice(note);

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
						...skippedJson(skipped, cwd),
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

		/** With paths, each is answered by the config that covers it, and one that nothing covers is said so and skipped. */
		private async diagnose(
			accessor: ServicesAccessor,
			given: readonly string[]
		): Promise<Result<Diagnosis, Error>> {
			const configService = accessor.get(ConfigService);
			const writeService = accessor.get(WriteService);
			const { cwd } = accessor.get(EnvironmentService);
			if (given.length === 0) {
				const selection = await configService.select(
					await configService.configsHere()
				);
				if (selection.isErr()) return selection;
				return writeService.diagnose(selection.value);
			}
			const asking = await AskedPaths.of(
				configService,
				writeService,
				cwd,
				given
			);
			if (asking.isErr()) return asking;
			const { asked, groups } = asking.value;
			const parts: Diagnosis[] = [];
			for (const { selection, indexes, whole } of groups) {
				const found = await writeService.diagnose(
					selection,
					whole
						? undefined
						: { args: asking.value.argsAt(indexes), cwd }
				);
				if (found.isErr()) return found;
				parts.push(found.value);
				const folder = path.dirname(selection.entries[0].file);
				if (
					!whole &&
					indexes.some((index) => {
						const one = asked[index];
						return "path" in one && samePath(one.path, folder);
					})
				)
					parts.push({
						diagnostics:
							await writeService.staleProjectFiles(selection),
						stoppedBy: [],
						skipped: [],
					});
			}
			const merged = mergeDiagnoses(parts);
			return ok({
				...merged,
				skipped: uniqueSkipped([
					...asking.value.uncovered,
					...merged.skipped,
				]),
			});
		}
	}
);
