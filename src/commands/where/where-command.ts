import { UsageError } from "../../base/errors.js";
import { relativeTo } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	BuildService,
	Locations,
	mergeLocations,
} from "../../domain/build/build-service.js";

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
								"A file, or a directory for the files in it; a file that doesn't exist yet is placed as if it did. A :line or :line:col after a file, as a linter prints it, is ignored. An instance as Studio prints it (ServerScriptService.Inventory.Save:12) gives the files behind it. '-' alone reads text on stdin and prints it with each instance path Studio printed, as Service.Feature.Name:12 or Script 'Service.Feature.Name', Line 12, written as file:line; an instance that more than one file places stays as it is and is listed on stderr. A path is answered by the default config of the nearest folder at or above it, and one that no config covers is skipped with a note; a .rogen.json lists every file of that config. Every file of the default config of the working directory when none is given, and an instance or '-' reads that config too.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: WhereOptions,
					output: { document: whereDocumentShape },
					effects: [],
					exitCodes: {
						"0": "every path answered, one that no file places included",
						"1": "no path was given, or the config has errors",
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

			const located = await this.locate(accessor, line.positionals);
			if (located.isErr()) return located;

			const answers = new WhereAnswers(located.value);
			const failure = DiagnosticsError.of(answers.errors);
			const { stale } = located.value;
			if (line.options.json)
				return this.printJson(
					logService,
					whereDocument(answers, stale),
					failure
				);
			new WhereLog(cwd, answers).print(logService);
			for (const diagnostic of stale) logService.diagnostic(diagnostic);
			return failure ? err(failure) : ok(undefined);
		}

		/** With paths, each is answered by the config that covers it, and one that nothing covers is said so and skipped. */
		private async locate(
			accessor: ServicesAccessor,
			args: readonly string[]
		): Promise<Result<Locations, Error>> {
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const { cwd } = accessor.get(EnvironmentService);
			if (args.length === 0) {
				const selection = await configService.select([]);
				if (selection.isErr()) return selection;
				return buildService.locate(selection.value, {
					args,
					cwd,
					staleness: true,
				});
			}
			const asked = await buildService.askedAbout({ args, cwd });
			const covered = await configService.selectCovering(
				asked.map((one) => ("path" in one ? one.path : undefined))
			);
			if (covered.isErr()) return covered;
			const logService = accessor.get(LogService);
			for (const index of covered.value.uncovered) {
				const one = asked[index];
				logService.warn(
					`${"path" in one ? relativeTo(cwd, one.path) : args[index]}: no config covers this file; see where it lands through a place: rogen where places/lobby`
				);
			}
			const parts: Locations[] = [];
			for (const { selection, indexes, whole } of covered.value.groups) {
				const located = await buildService.locate(selection, {
					args: whole ? [] : indexes.map((index) => args[index]),
					cwd,
					staleness: true,
				});
				if (located.isErr()) return located;
				parts.push(located.value);
			}
			const skipped = new Set(covered.value.uncovered);
			return ok(
				mergeLocations(
					parts,
					asked.filter((_, index) => !skipped.has(index))
				)
			);
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
				.get(BuildService)
				.locate(selection.value, { args: [...spans.values()], cwd });
			if (located.isErr()) return located;
			const logService = accessor.get(LogService);
			const files = new Map<string, string>();
			for (const [instance, candidates] of filesByInstance(
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
			return ok({
				files,
				failure: DiagnosticsError.of(located.value.errors),
			});
		}
	}
);

/** For each instance asked about: the files that place it, each with the configs it is placed in. Instances no file places are left out. */
function filesByInstance(
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
