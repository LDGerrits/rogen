import { DisposableStore } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	ProjectArgument,
	singleProjectError,
} from "../../domain/config/config-service.js";
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
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { buildRojoEntryShape, rojoEntry } from "../write/rojo-entry.js";
import {
	configsDocument,
	watchLineShapes,
	writeEntryShape,
} from "../write/write-document.js";
import { RojoRun } from "../write/rojo-run.js";
import { WriteWatch } from "../write/write-watch.js";
import { BuildStep } from "./build-step.js";

const S = OutputShape;

const buildDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	rojo: S.optional(buildRojoEntryShape),
});

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
			const tooMany = singleProjectError("build", line.positionals);
			if (tooMany) return err(tooMany);
			const flags = this.rojoFlags(line);
			if (flags.isErr()) return flags;
			const cwd = accessor.get(EnvironmentService).cwd;
			const instantiationService = accessor.get(InstantiationService);
			const lifecycleService = accessor.get(LifecycleService);
			const logService = accessor.get(LogService);
			const step = instantiationService.createInstance(
				BuildStep,
				flags.value,
				cwd,
				line.options.output,
				line.options.plugin
			);
			if (line.options.watch) {
				const store = new DisposableStore();
				const shutdown = this.untilShutdown(lifecycleService, store);
				try {
					return await instantiationService
						.createInstance(
							WriteWatch,
							line.positionals,
							Boolean(line.options.json),
							step,
							"build"
						)
						.run(store, shutdown);
				} finally {
					store[Symbol.dispose]();
				}
			}

			const rojoRun = instantiationService.createInstance(
				RojoRun,
				line.positionals,
				step,
				cwd
			);
			const done = await rojoRun.run();
			if (done.isErr()) return done;
			const { written, failure, ran, rojoFailure } = done.value;
			if (line.options.json) {
				const configs = configsDocument(written.outcomes, cwd);
				const rojo = rojoEntry(step.target, ran);
				return this.printJson(
					logService,
					{
						changed: configs.changed || rojo.outcome === "built",
						configs: configs.configs,
						rojo,
					},
					failure ?? rojoFailure
				);
			}
			rojoRun.report(done.value);
			if (rojoFailure) return err(rojoFailure);
			return failure ? this.reported(failure) : ok(undefined);
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
