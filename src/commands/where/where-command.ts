import { UsageError } from "../../base/errors.js";
import { relativeTo } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildService, Locations } from "../../domain/build/build-service.js";

import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { InputService } from "../../platform/input/input-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { WhereAnswers } from "./where-answers.js";
import { whereDocument, whereDocumentShape } from "./where-document.js";
import { WhereLog } from "./where-log.js";
import { rewriteStudioPaths, studioPathsIn } from "./studio-paths.js";

const WhereOptions = [JsonOption] as const;

registerCommand(
	class WhereCommand extends AbstractCommand<typeof WhereOptions> {
		constructor() {
			super({
				id: "where",
				metadata: {
					summary:
						"Prints where each file lands in the game, and why",
					description:
						"Prints where each file lands in the game, and why, with its warnings.",
					args: [
						{
							name: "path",
							description:
								"A file, or a directory for the files in it; a file that doesn't exist yet is placed as if it did. A :line or :line:col after a file, as a linter prints it, is ignored. An instance as Studio prints it (ServerScriptService.Inventory.Save:12) gives the files behind it. '-' alone reads text on stdin and prints it with each instance path Studio printed, as Service.Feature.Name:12 or Script 'Service.Feature.Name', Line 12, written as file:line; an instance that more than one file places stays as it is and is listed on stderr. Every file when none is given. The config here, or in the nearest folder above that has one, is read.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: WhereOptions,
					output: { document: whereDocumentShape },
					effects: [],
					examples: [
						"rogen where src/Inventory/Server/Save.luau",
						"rogen where ServerScriptService.Inventory.Save:12",
						"rogen where src --json",
						"pbpaste | rogen where -",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof WhereOptions>
		): Promise<Result<void, Error>> {
			if (line.positionals.includes("-"))
				return this.rewriteInput(accessor, line);
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const logService = accessor.get(LogService);

			const selection = await configService.select([]);
			if (selection.isErr()) return selection;
			const located = await buildService.locate(selection.value, {
				args: line.positionals,
				cwd,
			});
			if (located.isErr()) return located;

			const answers = new WhereAnswers(located.value);
			const failure = DiagnosticsError.of(answers.errors);
			if (line.options.json)
				return this.printJson(
					logService,
					whereDocument(answers),
					failure
				);
			new WhereLog(cwd, answers).print(logService);
			return failure ? err(failure) : ok(undefined);
		}

		private async rewriteInput(
			accessor: ServicesAccessor,
			line: CommandLine<typeof WhereOptions>
		): Promise<Result<void, Error>> {
			if (line.positionals.length > 1 || line.options.json)
				return err(
					new UsageError(
						"'-' reads text on stdin and prints it, so it takes no other path and no --json.",
						"Run 'rogen where -' on its own, or name the paths without '-'."
					)
				);
			const logService = accessor.get(LogService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const text = await accessor.get(InputService).readAll();
			const paths = studioPathsIn(text);
			const files = new Map<string, string>();
			let failure: DiagnosticsError | undefined;
			if (paths.length > 0) {
				const selection = await accessor.get(ConfigService).select([]);
				if (selection.isErr()) return selection;
				const spans = new Map(
					paths.map(({ reference, start, end }) => [
						reference.text,
						text.slice(start, end),
					])
				);
				const located = await accessor
					.get(BuildService)
					.locate(selection.value, {
						args: [...spans.values()],
						cwd,
					});
				if (located.isErr()) return located;
				failure = DiagnosticsError.of(located.value.errors);
				for (const [instance, candidates] of filesPlacing(
					located.value
				)) {
					if (candidates.size === 1) {
						const [file] = candidates.keys();
						files.set(instance, relativeTo(cwd, file));
					} else
						logService.warn(
							`${instance} is placed by more than one file, so it is left as it is: ${[
								...candidates,
							]
								.map(
									([file, labels]) =>
										`${[...labels].join(", ")}: ${relativeTo(cwd, file)}`
								)
								.join("; ")}.`
						);
				}
			}
			logService.print(
				rewriteStudioPaths(text, paths, (name) =>
					files.get(name)
				).replace(/\n$/, "")
			);
			return failure ? err(failure) : ok(undefined);
		}
	}
);

/** For each instance asked about: the files that place it, each with the configs it is placed in. Instances no file places are left out. */
function filesPlacing(
	locations: Locations
): Map<string, Map<string, Set<string>>> {
	const placing = new Map<string, Map<string, Set<string>>>();
	for (const { config, instances } of locations.configs)
		for (const { reference, files } of instances)
			for (const { source } of files) {
				const byFile = placing.get(reference.text) ?? new Map();
				placing.set(reference.text, byFile);
				const labels = byFile.get(source) ?? new Set();
				byFile.set(source, labels);
				labels.add(config.label);
			}
	return placing;
}
