import { UsageError } from "../../base/errors.js";
import { configPath } from "../../platform/config/config-path.js";
import { relativeTo } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	WriteService,
	skippedNotes,
} from "../../domain/write/write-service.js";
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
import {
	StudioPath,
	rewriteStudioPaths,
	studioPathsIn,
} from "./studio-paths.js";

const WhereOptions = [JsonOption] as const;

const ASKING = { command: "where", lead: "See where it lands" };

interface Services {
	readonly configService: ConfigService;
	readonly writeService: WriteService;
	readonly logService: LogService;
	readonly inputService: InputService;
	readonly cwd: string;
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
						"1": "the config has errors, or an error about what you asked stops its write",
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

			const found = await writeService.locateAsked({
				args: line.positionals,
				cwd,
			});
			if (found.isErr()) return found;
			const { locations, skipped } = found.value;

			for (const note of skippedNotes(found.value, cwd, ASKING))
				logService.notice(note);

			const answers = new WhereAnswers(locations);
			const failure = DiagnosticsError.of(answers.failing);
			if (line.options.json)
				return this.printJson(
					logService,
					whereDocument(answers, cwd, skipped),
					failure
				);
			new WhereLog(cwd, answers).print(logService);
			logService.diagnostics(answers.elsewhere);
			if (answers.elsewhere.length > 0)
				logService.notice(
					`The ${answers.elsewhere.length === 1 ? "error" : "errors"} above ${answers.elsewhere.length === 1 ? "stops" : "stop"} the write, but none of it is about what you asked; 'rogen check' lists everything to fix.`
				);
			if (!failure) return ok(undefined);
			const unprinted = DiagnosticsError.of(
				failure.diagnostics.filter(
					(error) =>
						answers.errors.includes(error) &&
						!answers.elsewhere.includes(error)
				)
			);
			return unprinted ? err(unprinted) : this.reported(failure);
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
			if (rewritten !== "") logService.result(rewritten);
			if (placed.isErr()) return placed;
			return placed.value.failure
				? err(placed.value.failure)
				: ok(undefined);
		}

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
