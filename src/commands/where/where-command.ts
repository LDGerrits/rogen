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

/** What the command takes from the accessor before its first await. */
interface Services {
	readonly configService: ConfigService;
	readonly writeService: WriteService;
	readonly logService: LogService;
	readonly inputService: InputService;
	readonly cwd: string;
}

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
								"- Config: the default config of the nearest folder at or above the path; with none, every .rogen.json at or above it whose source paths cover it. A .rogen.json, or a config named as build reads it (game for game.rogen.json), lists all its files.",
								"- Several configs: each answer names its config file, as config does in the JSON.",
								"- Skipped: a path Rogen leaves out gets a note on stderr and a skipped entry in the JSON.",
								"- No path: every file of every config of the working directory. An instance or '-': a config named beside it, else the default.",
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
						"1": "the config has errors, or an error stops its write",
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
			const cwd = accessor.get(EnvironmentService).cwd;
			const logService = accessor.get(LogService);
			const configService = accessor.get(ConfigService);
			const writeService = accessor.get(WriteService);
			if (line.positionals.includes("-"))
				return this.rewriteInput(
					{
						configService,
						writeService,
						logService,
						inputService: accessor.get(InputService),
						cwd,
					},
					line
				);

			const found = await this.locate(
				configService,
				writeService,
				cwd,
				line.positionals
			);
			if (found.isErr()) return found;
			const { locations, skipped } = found.value;

			for (const note of await skippedNotes(
				configService,
				skipped,
				cwd,
				ASKING
			))
				logService.notice(note);

			const answers = new WhereAnswers(locations);
			const failure = DiagnosticsError.of(answers.errors);
			const stopped = DiagnosticsError.of(answers.stops);
			if (line.options.json)
				return this.printJson(
					logService,
					whereDocument(answers, cwd, skipped),
					failure ?? stopped
				);
			new WhereLog(cwd, answers).print(logService);
			if (failure) return err(failure);
			return stopped ? this.reported(stopped) : ok(undefined);
		}

		/** With paths, each is answered by the config that covers it, and one that nothing covers is said so and skipped. */
		private async locate(
			configService: ConfigService,
			writeService: WriteService,
			cwd: string,
			given: readonly string[]
		): Promise<Result<Located, Error>> {
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
			services: Services,
			line: CommandLine<typeof WhereOptions>
		): Promise<Result<void, Error>> {
			if (line.options.json)
				return err(
					new UsageError(
						"'-' reads text on stdin and prints it, so it takes no --json.",
						"Run 'rogen where -' without --json, or name the paths without '-'."
					)
				);
			const { configService, logService, inputService: input } = services;
			const configs = line.positionals.filter((arg) => arg !== "-");
			const notConfig = await configService.firstNotConfig(configs);
			if (notConfig !== undefined)
				return err(
					new UsageError(
						`'-' takes only configs beside it; ${notConfig} is not a config.`,
						"Name a config as game, game.rogen.json or a folder with a default.rogen.json."
					)
				);
			if (input.isTerminal)
				return err(
					new UsageError(
						"'-' reads text on stdin, and stdin is a terminal.",
						"Pipe the text in, as 'pbpaste | rogen where -'."
					)
				);
			const text = await input.readAll();
			const paths = studioPathsIn(text);
			const placed =
				paths.length > 0
					? await this.filesPlacing(services, configs, text, paths)
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

		/** The file that places each instance in `paths` in `configs`, else the default config, relative to the working directory; one that several files place is warned about and left out. Fails when no config can answer; carries the errors of those that didn't load. */
		private async filesPlacing(
			{ configService, writeService, logService, cwd }: Services,
			configs: readonly string[],
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
			const selection = await configService.select(configs);
			if (selection.isErr()) return selection;
			const spans = new Map(
				paths.map(({ reference, start, end }) => [
					reference.text,
					text.slice(start, end),
				])
			);
			const located = await writeService.locate(selection.value, {
				args: [...spans.values()],
				cwd,
			});
			if (located.isErr()) return located;
			const files = new Map<string, string>();
			for (const [instance, byFile] of new WhereAnswers(
				located.value
			).byInstance()) {
				if (byFile.size === 1) {
					const [file] = byFile.keys();
					files.set(instance, relativeTo(cwd, file));
				} else
					logService.warn(
						`${instance} is placed by more than one file, so it is left as it is: ${[
							...byFile,
						]
							.map(
								([file, placing]) =>
									`${[...new Set(placing.map(({ config }) => configPath(cwd, config)))].join(", ")}: ${relativeTo(cwd, file)}`
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
