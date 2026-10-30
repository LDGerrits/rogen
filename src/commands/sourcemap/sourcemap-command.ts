import { randomUUID } from "crypto";
import path from "path";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { WriteService } from "../../domain/write/write-service.js";
import {
	ProjectArgument,
	singleProjectError,
	ConfigService,
} from "../../domain/config/config-service.js";
import {
	RojoCommandRun,
	RojoCommandService,
} from "../../domain/runner/rojo-command-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { OutcomeLog } from "../write/outcome-log.js";
import { WriteWatch } from "../write/write-watch.js";
import {
	reportRojo,
	reportRojoBesideFailure,
	rojoDone,
} from "../write/report-rojo.js";
import { rojoEntry } from "../write/rojo-entry.js";
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
		"Include instances that are not scripts, such as folders' files and models.",
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
		"Keep going: write the project file again whenever names or configs change. Write the sourcemap after each write, and after each edit of a file under the source paths. Without -o it prints each sourcemap, which leaves no room for --json. Press Ctrl+C to stop; --json prints one JSON object per line.",
} as const satisfies OptionDescriptor;

const SourcemapOptions = [
	JsonOption,
	OutputOption,
	IncludeNonScriptsOption,
	AbsoluteOption,
	WatchOption,
] as const;

/** What went wrong with the run: its error, else the diagnostics of its failure. */
function failureOf(
	ran: Result<RojoCommandRun, Error> | undefined
): Error | undefined {
	if (ran === undefined) return undefined;
	if (ran.isErr()) return ran.error;
	return DiagnosticsError.of(ran.value.failure?.diagnostics ?? []);
}

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
						"2": "the command line is wrong, or Rojo refused it",
					},
					examples: [
						"rogen sourcemap",
						"rogen sourcemap -o sourcemap.json",
						"rogen sourcemap places/lobby --include-non-scripts",
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
			const rojoService = accessor.get(RojoCommandService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const step = new SourcemapStep(
				rojoService,
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
				const shutdown = this.untilShutdown(accessor, store);
				try {
					return await new WriteWatch(
						accessor,
						line.positionals,
						Boolean(json),
						step
					).run(store, shutdown);
				} finally {
					store[Symbol.dispose]();
				}
			}

			const logService = accessor.get(LogService);
			if (!json && output === undefined) logService.reserveStdout();
			const fileSystemService = accessor.get(FileSystemService);
			const selection = await accessor
				.get(ConfigService)
				.select(line.positionals);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);

			const planned = step.plan(selection.value);
			if (planned.isErr()) return planned;
			const plan = planned.value;

			const written = await accessor
				.get(WriteService)
				.write(selection.value);
			const failure = written.failure();

			const tmp = path.join(
				accessor.get(EnvironmentService).tmpDir,
				`rogen-sourcemap-${randomUUID()}.json`
			);
			const ran =
				failure || plan === undefined
					? undefined
					: await rojoService.run(selection.value, {
							command: step.command,
							flags: plan.printed
								? [...plan.flags, "--output", tmp]
								: plan.flags,
							cwd: plan.cwd,
							project: plan.project,
						});
			const rojoFailure = failureOf(ran);
			const printed = plan?.printed === true;
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
						rojoEntry(
							plan?.target ?? {
								command: "sourcemap",
								cwd,
								output,
							},
							ran
						)
					),
					failure ?? rojoFailure
				);
			const outcomeLog = new OutcomeLog(logService, cwd);
			outcomeLog.outcomes(written, selection.value.home, "sourcemap");
			if (plan && ran?.isOk()) {
				const { messages, failure: runFailure } = ran.value;
				(runFailure ? reportRojoBesideFailure : reportRojo)(
					logService,
					messages.filter(
						({ severity, stdout }) =>
							(stdout !== undefined && !plan.printed) ||
							severity === "warning" ||
							severity === "error"
					),
					cwd
				);
			}
			if (!printed)
				outcomeLog.close(written, "sourcemap", true, {
					said: rojoDone(
						plan?.target ?? { command: "sourcemap", cwd, output },
						cwd
					),
					failed: rojoFailure !== undefined,
				});
			const rojoProblem = rojoFailure ?? unread;
			if (rojoProblem) return err(rojoProblem);
			return failure ? this.reported(failure) : ok(undefined);
		}
	}
);
