import { UsageError } from "../../base/errors.js";
import { configPath } from "../../platform/config/config-path.js";
import { relativeTo } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	WriteService,
	Locations,
	mergeLocations,
	uniqueSkipped,
} from "../../domain/write/write-service.js";

import { AskedPaths, skippedNotes } from "../../domain/write/asked-paths.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { SkippedPath } from "../../platform/diagnostics/skipped-path.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { InputService } from "../../platform/input/input-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { WhereAnswers } from "./where-answers.js";
import { whereDocument, whereDocumentShape } from "./where-document.js";
import { WhereLog } from "./where-log.js";
import {
	StudioPath,
	rewriteStudioPaths,
	studioPathsIn,
} from "./studio-paths.js";

const WhereOptions = [JsonOption] as const;

const ASKING = { command: "where", lead: "See where it lands" };

interface Located {
	readonly locations: Locations;
	/** The paths asked about that no write reads. */
	readonly skipped: readonly SkippedPath[];
}

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
							description: [
								"A file, a directory, a Studio instance path, or '-' for text on stdin. A directory gives the files in it, and a file that doesn't exist yet is placed as if it did. A :line or :line:col after a file is ignored.",
								"- Instance: a path as Studio prints it (ServerScriptService.Inventory.Save:12) gives the files behind it.",
								"- '-': reads text on stdin and prints it with each Studio instance path (Service.Feature.Name:12 or Script 'Service.Feature.Name', Line 12) written as file:line; an instance that several files place stays as it is, and is listed on stderr.",
								"- Config: the default config of the nearest folder at or above the path; with none, every .rogen.json at or above it whose source paths cover it. A .rogen.json, or a config named as build reads it (game for game.rogen.json), lists every file of that config.",
								"- Several configs: each answer names its config file, and so does config in the JSON.",
								"- Skipped: a path Rogen leaves out gets a note on stderr, and is listed under skipped in the JSON document.",
								"- No path: every file of every config of the working directory. An instance or '-': its default config.",
							].join("\n"),
							isOptional: true,
							isVariadic: true,
						},
					],
					options: WhereOptions,
					output: { document: whereDocumentShape },
					effects: [],
					exitCodes: {
						"0": "every path answered, one that no file places included",
						"1": "the config has errors",
					},
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
			const cwd = accessor.get(EnvironmentService).cwd;
			const logService = accessor.get(LogService);

			const found = await this.locate(accessor, line.positionals);
			if (found.isErr()) return found;
			const { locations, skipped } = found.value;

			for (const note of await skippedNotes(
				accessor.get(ConfigService),
				skipped,
				cwd,
				ASKING
			))
				logService.notice(note);

			const answers = new WhereAnswers(locations);
			const failure = DiagnosticsError.of(answers.errors);
			if (line.options.json)
				return this.printJson(
					logService,
					whereDocument(answers, cwd, skipped),
					failure
				);
			new WhereLog(cwd, answers).print(logService);
			return failure ? err(failure) : ok(undefined);
		}

		/** With paths, each is answered by the config that covers it, and one that nothing covers is said so and skipped. */
		private async locate(
			accessor: ServicesAccessor,
			given: readonly string[]
		): Promise<Result<Located, Error>> {
			const configService = accessor.get(ConfigService);
			const writeService = accessor.get(WriteService);
			const { cwd } = accessor.get(EnvironmentService);
			if (given.length === 0) {
				const selection = await configService.select(
					await configService.configsHere()
				);
				if (selection.isErr()) return selection;
				const located = await writeService.locate(selection.value, {
					args: given,
					cwd,
				});
				return located.map((locations) => ({ locations, skipped: [] }));
			}
			const asking = await AskedPaths.of(
				configService,
				writeService,
				cwd,
				given
			);
			if (asking.isErr()) return asking;
			const parts: Locations[] = [];
			for (const { selection, indexes, whole } of asking.value.groups) {
				const located = await writeService.locate(selection, {
					args: whole ? [] : asking.value.argsAt(indexes),
					cwd,
				});
				if (located.isErr()) return located;
				parts.push(located.value);
			}
			const locations = mergeLocations(parts, asking.value.covered);
			return ok({
				locations,
				skipped: uniqueSkipped([
					...asking.value.uncovered,
					...locations.skipped,
				]),
			});
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
			const input = accessor.get(InputService);
			if (input.isTerminal)
				return err(
					new UsageError(
						"'-' reads text on stdin, and stdin is a terminal.",
						"Pipe the text in, as 'pbpaste | rogen where -'."
					)
				);
			const logService = accessor.get(LogService);
			const text = await input.readAll();
			const paths = studioPathsIn(text);
			const placed =
				paths.length > 0
					? await this.filesPlacing(accessor, text, paths)
					: ok({
							files: new Map<string, string>(),
							failure: undefined,
						});
			const files = placed.isOk() ? placed.value.files : new Map();
			const rewritten = rewriteStudioPaths(text, paths, (name) =>
				files.get(name)
			).replace(/\r?\n$/, "");
			if (rewritten !== "") logService.print(rewritten);
			if (placed.isErr()) return placed;
			return placed.value.failure
				? err(placed.value.failure)
				: ok(undefined);
		}

		/** The file that places each instance in `paths`, relative to the working directory; one that several files place is warned about and left out. Fails when no config can answer; carries the errors of those that didn't load. */
		private async filesPlacing(
			accessor: ServicesAccessor,
			text: string,
			paths: readonly StudioPath[]
		): Promise<
			Result<
				{
					files: Map<string, string>;
					failure: DiagnosticsError | undefined;
				},
				Error
			>
		> {
			const cwd = accessor.get(EnvironmentService).cwd;
			const selection = await accessor.get(ConfigService).select([]);
			if (selection.isErr()) return selection;
			const spans = new Map(
				paths.map(({ reference, start, end }) => [
					reference.text,
					text.slice(start, end),
				])
			);
			const located = await accessor
				.get(WriteService)
				.locate(selection.value, { args: [...spans.values()], cwd });
			if (located.isErr()) return located;
			const logService = accessor.get(LogService);
			const files = new Map<string, string>();
			for (const [instance, candidates] of filesByInstance(
				located.value,
				cwd
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
			return ok({
				files,
				failure: DiagnosticsError.of(located.value.errors),
			});
		}
	}
);

/** For each instance asked about: the files that place it, each with the config files it is placed in. Instances no file places are left out. */
function filesByInstance(
	locations: Locations,
	cwd: string
): Map<string, Map<string, Set<string>>> {
	const placing = new Map<string, Map<string, Set<string>>>();
	for (const { config, instances } of locations.configs)
		for (const { reference, files } of instances)
			for (const { source } of files) {
				const byFile = placing.get(reference.text) ?? new Map();
				placing.set(reference.text, byFile);
				const labels = byFile.get(source) ?? new Set();
				byFile.set(source, labels);
				labels.add(configPath(cwd, config.file));
			}
	return placing;
}
