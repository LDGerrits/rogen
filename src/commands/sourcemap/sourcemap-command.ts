import { DisposableStore } from "../../base/disposable.js";
import { Result, err, ok } from "../../base/result.js";
import { UsageError } from "../../base/errors.js";
import { ProjectArgument } from "../../domain/config/config-service.js";
import { RojoRunRequest } from "../../domain/runner/rojo-command-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
	forwardedFlags,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { RojoTarget, rojoEntryShape } from "../write/rojo-entry.js";
import {
	RojoRunReport,
	rojoRunDocumentShape,
} from "../write/rojo-run-report.js";
import { watchLineShapes } from "../write/write-document.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import {
	PrintedWatchLog,
	RojoWatchReport,
	WatchJsonLog,
	WatchLog,
} from "../write/watch-log.js";

const S = OutputShape;

const sourcemapEntryShape = rojoEntryShape("sourcemap");

const sourcemapLineShape = S.union(
	watchLineShapes.write,
	S.object({ rojo: sourcemapEntryShape }),
	watchLineShapes.notice,
	watchLineShapes.error,
	watchLineShapes.diagnostics
);

const OutputOption = {
	name: "output",
	short: "o",
	type: "string",
	placeholder: "output",
	description: "Write the sourcemap to this file instead of printing it.",
} as const satisfies OptionDescriptor;

const IncludeNonScriptsOption = {
	name: "include-non-scripts",
	type: "boolean",
	description:
		"Include instances that are not scripts, such as folders, models and values.",
} as const satisfies OptionDescriptor;

const AbsoluteOption = {
	name: "absolute",
	type: "boolean",
	description:
		"Write absolute paths in the sourcemap instead of paths relative to the project.",
} as const satisfies OptionDescriptor;

const WatchOption = {
	name: "watch",
	type: "boolean",
	description:
		"Keep going, with Rojo's own sourcemap --watch. Rogen writes the project file again whenever names or configs change, and Rojo writes the sourcemap again whenever it changes. Without -o it prints each sourcemap, which leaves no room for --json. Press Ctrl+C to stop; --json prints one JSON object per line.",
} as const satisfies OptionDescriptor;

const SourcemapOptions = [
	JsonOption,
	OutputOption,
	IncludeNonScriptsOption,
	AbsoluteOption,
	WatchOption,
] as const;

registerCommand(
	class SourcemapCommand extends AbstractCommand<typeof SourcemapOptions> {
		constructor() {
			super({
				id: "sourcemap",
				metadata: {
					summary:
						"Writes the project file, then a sourcemap with Rojo",
					description:
						"Writes the project file, then has Rojo write a sourcemap of the project, printed unless -o names a file.",
					args: ProjectArgument,
					options: SourcemapOptions,
					output: {
						document: rojoRunDocumentShape(sourcemapEntryShape),
						lines: sourcemapLineShape,
					},
					effects: ["writesFiles", "runsProcesses"],
					longRunningWith: "watch",
					ownLinesToStderr: ({ options }) =>
						options.output === undefined && !options.json,
					exitCodes: {
						"1": "the project has errors, or Rojo failed",
						"2": "the command line is wrong, or Rojo refused it",
						"128+N":
							"stopped by a signal: 130 for Ctrl+C, 143 for SIGTERM, 129 for SIGHUP",
					},
					examples: [
						"rogen sourcemap",
						"rogen sourcemap -o sourcemap.json",
						"rogen sourcemap lobby --include-non-scripts",
						"rogen sourcemap --watch -o sourcemap.json",
						"rogen sourcemap --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof SourcemapOptions>
		): Promise<Result<void, Error>> {
			const { json, watch, output } = line.options;
			const cwd = accessor.get(EnvironmentService).cwd;
			const instantiationService = accessor.get(InstantiationService);
			const lifecycleService = accessor.get(LifecycleService);
			const prints = output === undefined && !json;
			const target: RojoTarget = { command: "sourcemap", cwd, output };
			const request: RojoRunRequest = {
				refs: line.positionals,
				command: "sourcemap",
				flags: this.rojoFlags(line),
				cwd,
				prints,
			};
			if (watch) {
				const store = new DisposableStore();
				const shutdown = this.untilShutdown(lifecycleService, store);
				try {
					const log = json
						? instantiationService.createInstance(WatchJsonLog, cwd)
						: prints
							? instantiationService.createInstance(
									PrintedWatchLog,
									cwd,
									"watch"
								)
							: instantiationService.createInstance(
									WatchLog,
									cwd,
									"sourcemap --watch"
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
			line: CommandLine<typeof SourcemapOptions>
		): Result<readonly string[], UsageError> {
			const { output, json } = line.options;
			if (output === undefined && json)
				return err(
					new UsageError(
						"Without -o the sourcemap is printed, which leaves no room for --json: give -o <file>."
					)
				);
			return ok(
				forwardedFlags(line.options, [
					IncludeNonScriptsOption,
					AbsoluteOption,
					OutputOption,
				])
			);
		}
	}
);
