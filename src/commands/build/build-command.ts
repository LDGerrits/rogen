import { DisposableStore } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { ProjectArgument } from "../../domain/config/config-service.js";
import { RojoRunRequest } from "../../domain/runner/rojo-command-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
	forwardedFlags,
} from "../../platform/environment/args.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { RojoTarget, buildRojoEntryShape } from "../write/rojo-entry.js";
import { watchLineShapes } from "../write/write-document.js";
import {
	RojoRunReport,
	rojoRunDocumentShape,
} from "../write/rojo-run-report.js";
import { RojoWatchReport, WatchJsonLog, WatchLog } from "../write/watch-log.js";

const S = OutputShape;

const buildDocumentShape = rojoRunDocumentShape(
	S.optional(buildRojoEntryShape)
);

const buildLineShape = S.union(
	watchLineShapes.write,
	S.object({ rojo: buildRojoEntryShape }),
	watchLineShapes.notice,
	watchLineShapes.error,
	watchLineShapes.diagnostics
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
		"Keep going, and build with Rojo's own build --watch. Rogen writes the project file again whenever names or configs change, and Rojo builds again after a change to any path the project file mounts. Press Ctrl+C to stop; --json prints one JSON object per line.",
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
					exitCodes: {
						"1": "the project has errors, or Rojo failed",
						"128+N":
							"stopped by a signal: 130 for Ctrl+C, 143 for SIGTERM, 129 for SIGHUP",
					},
					examples: [
						"rogen build -o game.rbxl",
						"rogen build lobby -o lobby.rbxl",
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
			const cwd = accessor.get(EnvironmentService).cwd;
			const instantiationService = accessor.get(InstantiationService);
			const lifecycleService = accessor.get(LifecycleService);
			const { output, plugin, json } = line.options;
			const target: RojoTarget = {
				command: "build",
				cwd,
				output,
				plugin,
			};
			const request: RojoRunRequest = {
				refs: line.positionals,
				command: "build",
				flags: this.rojoFlags(line),
				cwd,
			};
			if (line.options.watch) {
				const store = new DisposableStore();
				const shutdown = this.untilShutdown(lifecycleService, store);
				try {
					const log = json
						? instantiationService.createInstance(WatchJsonLog, cwd)
						: instantiationService.createInstance(
								WatchLog,
								cwd,
								"build --watch"
							);
					return await instantiationService
						.createInstance(RojoWatchReport, log, target)
						.run(request, shutdown, store);
				} finally {
					store[Symbol.dispose]();
				}
			}

			return instantiationService
				.createInstance(RojoRunReport, target)
				.run(request, Boolean(json));
		}

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
			if (output !== undefined || plugin !== undefined)
				return ok(
					forwardedFlags(line.options, [OutputOption, PluginOption])
				);
			return err(
				new UsageError(
					"build needs -o <file> or -p <name>, as 'rojo build' does.",
					"To write the project file only, run 'rogen write'."
				)
			);
		}
	}
);
