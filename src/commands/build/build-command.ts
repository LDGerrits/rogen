import { DisposableStore } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";

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
import { BuildLog } from "./build-log.js";
import { BuildWatch } from "./build-watch.js";
import {
	buildDocument,
	buildDocumentShape,
	buildLineShape,
	rojoEntry,
} from "./build-document.js";
import { BuildStep } from "./build-step.js";
import { reportRojo, reportRojoBesideFailure } from "./report-rojo.js";

const OutputOption = {
	name: "output",
	short: "o",
	type: "string",
	placeholder: "output",
	description:
		"Also build the project into this place or model file with Rojo (.rbxl, .rbxlx, .rbxm or .rbxmx).",
} as const satisfies OptionDescriptor;

const PluginOption = {
	name: "plugin",
	short: "p",
	type: "string",
	placeholder: "plugin",
	description:
		"Also build the project into Roblox's plugins folder with Rojo, under this file name.",
} as const satisfies OptionDescriptor;

const WatchOption = {
	name: "watch",
	type: "boolean",
	description:
		"Keep going: write the project file again whenever names or configs change, and build with Rojo after each write when -o or -p is given. With -o or -p, an edit inside a file under the source paths builds again too. Press Ctrl+C to stop; --json prints one JSON object per line.",
} as const satisfies OptionDescriptor;

const ForceOption = {
	name: "force",
	type: "boolean",
	description:
		"Write a project file over an edit made to it by hand, which a build refuses to lose otherwise.",
} as const satisfies OptionDescriptor;

const BuildOptions = [
	JsonOption,
	OutputOption,
	PluginOption,
	WatchOption,
	ForceOption,
] as const;

registerCommand(
	class BuildCommand extends AbstractCommand<typeof BuildOptions> {
		constructor() {
			super({
				id: "build",
				metadata: {
					summary:
						"Writes the project file; with -o or -p, builds with Rojo",
					description:
						"Writes the project file of default.rogen.json here, or of the config you name, beside it (dist.rogen.json writes dist.project.json); with -o or -p, also builds a place, model or plugin with Rojo.",
					args: ProjectArgument,
					options: BuildOptions,
					output: {
						document: buildDocumentShape,
						lines: buildLineShape,
					},
					effects: ["writesFiles", "runsProcesses"],
					unknownWordOffer: "To build a project",
					longRunningWith: "watch",
					formerCommands: {
						watch: "'rogen watch' is now 'rogen build --watch'.",
					},
					formerOptions: {
						"--deny-warnings":
							"Run 'rogen check', which exits 1 on any diagnostic, warnings included.",
					},
					examples: [
						"rogen build",
						"rogen build places/lobby",
						"rogen build -o game.rbxl",
						"rogen build --watch",
						"rogen build --watch -o game.rbxl",
						"rogen build --json",
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
			const step =
				flags.value &&
				new BuildStep(
					accessor.get(RojoCommandService),
					flags.value,
					cwd,
					line.options.output,
					line.options.plugin
				);
			if (line.options.watch && line.options.force)
				return err(
					new UsageError(
						"--force is for one build, and --watch builds on every change.",
						"Run 'rogen build --force' once, then 'rogen build --watch'."
					)
				);
			if (line.options.watch) {
				const store = new DisposableStore();
				const shutdown = this.untilShutdown(accessor, store);
				try {
					return await new BuildWatch(
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
			const buildService = accessor.get(BuildService);
			const logService = accessor.get(LogService);
			if (flags.value && !line.options.json) logService.reserveStdout();

			const selection = await configService.select(line.positionals);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);

			const planned = step?.plan(selection.value);
			if (planned?.isErr()) return planned;

			const run = await buildService.build(
				selection.value,
				Boolean(line.options.force)
			);

			const failure = run.failure();
			const plan = planned?.isOk() ? planned.value : undefined;
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
						...buildDocument(run.builds),
						...(flags.value && {
							rojo: rojoEntry(
								{
									command: "build",
									cwd,
									output: line.options.output,
									plugin: line.options.plugin,
								},
								built
							),
						}),
					},
					failure ?? rojoFailure
				);
			new BuildLog(logService, cwd).report(run, selection.value.home);
			if (built?.isOk())
				(rojoFailure ? reportRojoBesideFailure : reportRojo)(
					logService,
					built.value.messages,
					cwd
				);
			if (rojoFailure) return err(rojoFailure);
			return failure ? this.reported(failure) : ok(undefined);
		}

		/** Rojo's flags for the build, or none when only the project files are wanted. */
		private rojoFlags(
			line: CommandLine<typeof BuildOptions>
		): Result<readonly string[] | undefined, UsageError> {
			const { output, plugin } = line.options;
			if (output !== undefined && plugin !== undefined)
				return err(
					new UsageError(
						"-o builds a place or model file and -p a plugin: give one of them."
					)
				);
			if (output !== undefined) return ok(["--output", output]);
			if (plugin !== undefined) return ok(["--plugin", plugin]);
			return ok(undefined);
		}
	}
);
