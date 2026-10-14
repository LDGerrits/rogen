import { DisposableStore } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";

import {
	ConfigArguments,
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
import { buildDocument } from "./build-document.js";
import { reportRojo } from "./report-rojo.js";

const DenyWarningsOption = {
	name: "deny-warnings",
	type: "boolean",
	description: "Exit 1 when any config has a warning.",
} as const satisfies OptionDescriptor;

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
		"Keep going: write the project files again whenever names or configs change, and build with Rojo after each write when -o or -p is given. Press Ctrl+C to stop; --json prints one JSON object per line.",
} as const satisfies OptionDescriptor;

const BuildOptions = [
	JsonOption,
	DenyWarningsOption,
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
					description:
						"Writes default.project.json, and a file for each project, beside the rogen.json here or beside each named one; with -o or -p, also builds a place, model or plugin with Rojo.",
					args: ConfigArguments,
					options: BuildOptions,
					unknownWordOffer: "To build a project",
					longRunningWith: "watch",
					formerCommands: {
						watch: "'rogen watch' is now 'rogen build --watch'.",
					},
					examples: [
						"rogen build",
						"rogen build places/lobby",
						"rogen build -o game.rbxl",
						"rogen build --watch",
						"rogen build --watch -o game.rbxl",
						"rogen build --json",
						"rogen build --deny-warnings",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof BuildOptions>
		): Promise<Result<void, Error>> {
			const flags = this.rojoFlags(line);
			if (flags.isErr()) return flags;
			if (line.options.watch) {
				const store = new DisposableStore();
				const shutdown = this.untilShutdown(accessor, store);
				try {
					return await new BuildWatch(
						accessor,
						line.positionals,
						Boolean(line.options.json),
						flags.value
					).run(store, shutdown);
				} finally {
					store[Symbol.dispose]();
				}
			}

			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const logService = accessor.get(LogService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const selection = await configService.select(line.positionals);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);

			const run = await buildService.build(selection.value);

			const denyWarnings = Boolean(line.options["deny-warnings"]);
			const failure = run.failure(denyWarnings);
			const built =
				failure || flags.value === undefined
					? undefined
					: await accessor
							.get(RojoCommandService)
							.run(selection.value, {
								command: "build",
								flags: flags.value,
								cwd,
							});
			const rojoFailure = built?.isErr() ? built.error : undefined;
			if (line.options.json) {
				if (rojoFailure) logService.error(rojoFailure.message);
				return this.printJson(
					logService,
					buildDocument(run.builds),
					failure ?? rojoFailure
				);
			}
			new BuildLog(logService, cwd).report(
				run,
				selection.value.home,
				denyWarnings
			);
			if (built?.isOk())
				reportRojo(logService, built.value.messages, cwd);
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
