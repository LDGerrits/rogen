import path from "path";
import { DisposableStore } from "../../base/disposable.js";
import { Result, ok } from "../../base/result.js";
import { BuildRun } from "../../domain/build/build.js";
import { BuildService } from "../../domain/build/build-service.js";
import { isDefaultConfigFileName } from "../../domain/config/config.js";
import { ConfigService } from "../../domain/config/config-service.js";
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
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	buildDocument,
	buildDocumentShape,
	buildLineShape,
} from "../build/build-document.js";
import { BuildWatch } from "../build/build-watch.js";
import { WriteLog } from "./write-log.js";

const WatchOption = {
	name: "watch",
	type: "boolean",
	description:
		"Keep going: write the project files again whenever names or configs change. Press Ctrl+C to stop; --json prints one JSON object per line.",
} as const satisfies OptionDescriptor;

const WriteOptions = [JsonOption, WatchOption] as const;

const WriteArguments = [
	{
		name: "project",
		description:
			"A folder, a .rogen.json file, or the name of a file here. A name such as dist stands for dist.rogen.json. Every .rogen.json of the working directory when none is given.",
		isOptional: true,
		isVariadic: true,
	},
] as const;

registerCommand(
	class WriteCommand extends AbstractCommand<typeof WriteOptions> {
		constructor() {
			super({
				id: "write",
				metadata: {
					summary: "Writes the project file of every config here",
					description:
						"Writes the project file of every .rogen.json of the working directory, or of the configs you name, beside each (dist.rogen.json writes dist.project.json). A config that does not load does not stop the others; the run then exits 1. A project file with no .rogen.json is left alone.",
					args: WriteArguments,
					options: WriteOptions,
					output: {
						document: buildDocumentShape,
						lines: buildLineShape,
					},
					effects: ["writesFiles"],
					unknownWordOffer: "To write a project file",
					longRunningWith: "watch",
					examples: [
						"rogen write",
						"rogen write places/lobby",
						"rogen write game lobby",
						"rogen write --watch",
						"rogen write --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof WriteOptions>
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			const targets = await this.targets(configService, line.positionals);
			if (targets.isErr()) return targets;
			const { refs, plain } = targets.value;

			if (line.options.watch) {
				const store = new DisposableStore();
				const shutdown = this.untilShutdown(accessor, store);
				try {
					return await new BuildWatch(
						accessor,
						this.watched(refs),
						Boolean(line.options.json),
						undefined,
						"write"
					).run(store, shutdown);
				} finally {
					store[Symbol.dispose]();
				}
			}

			const logService = accessor.get(LogService);
			const { cwd } = accessor.get(EnvironmentService);
			let home = cwd;
			let run = new BuildRun([]);
			if (refs.length > 0) {
				const selection = await configService.select(refs);
				if (selection.isErr()) return selection;
				for (const note of selection.value.notes) logService.warn(note);
				home = selection.value.home;
				run = await accessor
					.get(BuildService)
					.build(selection.value, { independent: true });
			}

			const failure = run.failure();
			if (line.options.json)
				return this.printJson(
					logService,
					buildDocument(run.builds, cwd),
					failure
				);
			new WriteLog(logService, cwd).report(run, home, plain);
			return failure ? this.reported(failure) : ok(undefined);
		}

		/** A lone default config is watched as the default, so the watch follows the folder when its source paths come and go. */
		private watched(refs: readonly string[]): readonly string[] {
			return refs.length === 1 &&
				isDefaultConfigFileName(path.basename(refs[0]))
				? []
				: refs;
		}

		/** The configs to write: the ones named, else every one of the working directory, and the plain project files that are left alone. */
		private async targets(
			configService: ConfigService,
			given: readonly string[]
		): Promise<
			Result<{ refs: readonly string[]; plain: readonly string[] }, Error>
		> {
			if (given.length > 0) return ok({ refs: given, plain: [] });
			const refs = await configService.configsHere();
			if (refs.length > 0)
				return ok({
					refs,
					plain: await configService.plainProjectsHere(),
				});
			const here = await configService.select([]);
			if (here.isErr()) return here;
			return ok({
				refs: [],
				plain: await configService.plainProjectsHere(),
			});
		}
	}
);
