import { randomUUID } from "crypto";
import path from "path";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	ProjectArgument,
	singleProjectError,
} from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { rojoEntry } from "../write/rojo-entry.js";
import { RojoRun } from "../write/rojo-run.js";
import { WriteWatch } from "../write/write-watch.js";
import {
	sourcemapDocument,
	sourcemapDocumentShape,
	sourcemapLineShape,
} from "./sourcemap-document.js";
import { SourcemapStep } from "./sourcemap-step.js";

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
						document: sourcemapDocumentShape,
						lines: sourcemapLineShape,
					},
					effects: ["writesFiles", "runsProcesses"],
					longRunningWith: "watch",
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
			const tooMany = singleProjectError("sourcemap", line.positionals);
			if (tooMany) return err(tooMany);
			const { json, watch, output } = line.options;
			const { cwd, tmpDir } = accessor.get(EnvironmentService);
			const instantiationService = accessor.get(InstantiationService);
			const lifecycleService = accessor.get(LifecycleService);
			const logService = accessor.get(LogService);
			const fileSystemService = accessor.get(FileSystemService);
			const step = instantiationService.createInstance(
				SourcemapStep,
				{
					output,
					includeNonScripts: Boolean(
						line.options["include-non-scripts"]
					),
					absolute: Boolean(line.options.absolute),
				},
				cwd,
				!json
			);
			if (watch) {
				const store = new DisposableStore();
				const shutdown = this.untilShutdown(lifecycleService, store);
				try {
					return await instantiationService
						.createInstance(
							WriteWatch,
							line.positionals,
							Boolean(json),
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
			const tmp = path.join(
				tmpDir,
				`rogen-sourcemap-${randomUUID()}.json`
			);
			const done = await rojoRun.run(
				step.prints ? ["--output", tmp] : []
			);
			if (done.isErr()) return done;
			const { plan, written, failure, ran, rojoFailure } = done.value;
			const printed = plan !== undefined && step.prints;
			let unread: Error | undefined;
			if (printed) {
				if (!rojoFailure && !failure) {
					const text = await tryWithAsync(() =>
						fileSystemService.readFile(tmp)
					);
					if (text.isOk()) logService.print(text.value.trimEnd());
					else
						unread = ErrorUtils.wrap(
							"Failed to read the sourcemap Rojo wrote",
							text.error
						);
				}
				await fileSystemService.delete(tmp).catch(() => undefined);
			}

			if (json)
				return this.printJson(
					logService,
					sourcemapDocument(
						written.outcomes,
						cwd,
						rojoEntry(step.target, ran)
					),
					failure ?? rojoFailure
				);
			rojoRun.report(done.value, (messages) =>
				messages.filter(
					({ severity, stdout }) =>
						(stdout !== undefined && !step.prints) ||
						severity === "warning" ||
						severity === "error"
				)
			);
			const rojoProblem = rojoFailure ?? unread;
			if (rojoProblem) return err(rojoProblem);
			return failure ? this.reported(failure) : ok(undefined);
		}
	}
);
