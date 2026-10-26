import path from "path";
import { DisposableStore } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { relativeTo } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { WriteService } from "../../domain/write/write-service.js";

import {
	ProjectArgument,
	singleProjectError,
	ConfigService,
} from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { OutcomeLog } from "../write/outcome-log.js";
import { reportRojo, reportRojoBesideFailure } from "../write/report-rojo.js";
import { buildRojoEntryShape, rojoEntry } from "../write/rojo-entry.js";
import {
	configsDocument,
	watchLineShapes,
	writeEntryShape,
} from "../write/write-document.js";
import { WriteWatch } from "../write/write-watch.js";
import { BuildStep } from "./build-step.js";

const S = OutputShape;

/** The document of `build --json`. */
const buildDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	rojo: S.optional(buildRojoEntryShape),
});

/** One line of `build --watch --json`. */
const buildLineShape = S.union(
	watchLineShapes.write,
	S.object({ rojo: buildRojoEntryShape }),
	watchLineShapes.notice,
	watchLineShapes.error
);

const OutputOption = {
	name: "output",
	short: "o",
	type: "string",
	placeholder: "output",
	description:
		"Build the project into this place or model file with Rojo (.rbxl, .rbxlx, .rbxm or .rbxmx). This or -p is required.",
} as const satisfies OptionDescriptor;

const PluginOption = {
	name: "plugin",
	short: "p",
	type: "string",
	placeholder: "plugin",
	description:
		"Build the project into Roblox's plugins folder with Rojo, under this file name. This or -o is required.",
} as const satisfies OptionDescriptor;

const WatchOption = {
	name: "watch",
	type: "boolean",
	description:
		"Keep going: write the project file again whenever names or configs change. Build with Rojo after each write, and again after an edit inside a file under the source paths. Press Ctrl+C to stop; --json prints one JSON object per line.",
} as const satisfies OptionDescriptor;

const BuildOptions = [
	JsonOption,
	OutputOption,
	PluginOption,
	WatchOption,
] as const;

registerCommand(
	class BuildCommand extends AbstractCommand<typeof BuildOptions> {
		constructor() {
			super({
				id: "build",
				metadata: {
					summary: "Writes the project file, then builds with Rojo",
					description:
						"Writes the project file, then builds a place, model or plugin from it with Rojo, as 'rojo build' does. Give -o or -p. To write only the project file, run 'rogen write'.",
					args: ProjectArgument,
					options: BuildOptions,
					output: {
						document: buildDocumentShape,
						lines: buildLineShape,
					},
					effects: ["writesFiles", "runsProcesses"],
					longRunningWith: "watch",
					formerCommands: {
						watch: "'rogen watch' is now 'rogen write --watch'.",
					},
					examples: [
						"rogen build -o game.rbxl",
						"rogen build places/lobby -o lobby.rbxl",
						"rogen build -p Tool.rbxm",
						"rogen build -o game.rbxl --watch",
						"rogen build -o game.rbxl --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof BuildOptions>
		): Promise<Result<void, Error>> {
			const tooMany = singleProjectError("build", line.positionals);
			if (tooMany) return err(tooMany);
			const flags = this.rojoFlags(line);
			if (flags.isErr()) return flags;
			const cwd = accessor.get(EnvironmentService).cwd;
			const step = new BuildStep(
				accessor.get(RojoCommandService),
				flags.value,
				cwd,
				line.options.output,
				line.options.plugin
			);
			if (line.options.watch) {
				const store = new DisposableStore();
				const shutdown = this.untilShutdown(accessor, store);
				try {
					return await new WriteWatch(
						accessor,
						line.positionals,
						Boolean(line.options.json),
						step
					).run(store, shutdown);
				} finally {
					store[Symbol.dispose]();
				}
			}

			const configService = accessor.get(ConfigService);
			const writeService = accessor.get(WriteService);
			const logService = accessor.get(LogService);
			if (!line.options.json) logService.reserveStdout();

			const selection = await configService.select(line.positionals);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);

			const planned = step.plan(selection.value);
			if (planned.isErr()) return planned;

			const run = await writeService.write(selection.value);

			const failure = run.failure();
			const plan = planned.value;
			const built =
				failure || plan === undefined
					? undefined
					: await accessor
							.get(RojoCommandService)
							.run(selection.value, {
								command: "build",
								flags: plan.flags,
								cwd,
								project: plan.project,
							});
			const rojoFailure =
				built === undefined
					? undefined
					: built.isErr()
						? built.error
						: built.value.failure;
			if (line.options.json)
				return this.printJson(
					logService,
					{
						...configsDocument(run.outcomes, cwd),
						rojo: rojoEntry(
							{
								command: "build",
								cwd,
								output: line.options.output,
								plugin: line.options.plugin,
							},
							built
						),
					},
					failure ?? rojoFailure
				);
			new OutcomeLog(logService, cwd).report(
				run,
				selection.value.home,
				"build",
				true,
				{
					name: this.builtName(line, cwd),
					failed: rojoFailure !== undefined,
				}
			);
			if (built?.isOk())
				(rojoFailure ? reportRojoBesideFailure : reportRojo)(
					logService,
					built.value.messages,
					cwd
				);
			if (rojoFailure) return err(rojoFailure);
			return failure ? this.reported(failure) : ok(undefined);
		}

		/** The file or plugin the closing line says was built. */
		private builtName(
			line: CommandLine<typeof BuildOptions>,
			cwd: string
		): string {
			const { output, plugin } = line.options;
			return output !== undefined
				? relativeTo(cwd, path.resolve(cwd, output))
				: `plugin ${plugin}`;
		}

		/** Rojo's flags for the build, which needs one of `-o` and `-p`, as `rojo build` does. */
		private rojoFlags(
			line: CommandLine<typeof BuildOptions>
		): Result<readonly string[], UsageError> {
			const { output, plugin } = line.options;
			if (output !== undefined && plugin !== undefined)
				return err(
					new UsageError(
						"-o builds a place or model file and -p a plugin: give one of them."
					)
				);
			if (output !== undefined) return ok(["--output", output]);
			if (plugin !== undefined) return ok(["--plugin", plugin]);
			return err(
				new UsageError(
					"build needs -o <file> or -p <name>, as 'rojo build' does.",
					"To write the project file only, run 'rogen write'."
				)
			);
		}
	}
);
