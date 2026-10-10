import path from "path";
import { CancelledError, ReportedError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { plural } from "../../base/strings.js";
import { BuildRun, ConfigBuild } from "../../domain/build/build.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	InitPlan,
	InitService,
	NextSteps,
} from "../../domain/init/init-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build/build-log.js";
import { buildReport } from "../build/build-report.js";

const InitOptions = [
	{
		name: "yes",
		short: "y",
		type: "boolean",
		description:
			"Write the defaults without asking, as a run without a terminal, or under a coding agent or CI, does. --json implies it.",
	},
	JsonOption,
] as const;

const indent = (line: string) => `  ${line}`;

/** The next steps as printed: long-running commands grouped, since each keeps its terminal busy. */
const stepLines = ({ setup, run, darklua, edits }: NextSteps): string[] => [
	...setup,
	...(run.length > 0
		? [
				run.length === 1 ? "Run:" : "Run each in its own terminal:",
				...run.map(indent),
			]
		: []),
	...(darklua.length > 0
		? [
				"Have Darklua process your code into the sync dir:",
				...darklua.map(indent),
			]
		: []),
	...edits,
];

/** What a build found, less the sync dir's warnings: the compiler they ask for hasn't run in a project that was just written. */
const foundBy = (build: ConfigBuild): Diagnostic[] => [
	...build.warnings,
	...build.errors,
];

registerCommand(
	class InitCommand extends AbstractCommand<typeof InitOptions> {
		constructor() {
			super({
				id: "init",
				metadata: {
					description:
						"Writes a starting config, detecting the workspace and asking in a terminal.",
					args: [
						{
							name: "name",
							description:
								"The config to write. Defaults to default. Beside an existing default.rogen.json, a run that doesn't ask adds it as a place: its code in places/<name>/src, beside a template with its name and its own servePort.",
							isOptional: true,
						},
					],
					options: InitOptions,
					examples: [
						"rogen init",
						"rogen init lobby",
						"rogen init -y",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof InitOptions>
		): Promise<Result<void, Error>> {
			const initService = accessor.get(InitService);
			const logService = accessor.get(LogService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const buildConfigs = (plan: InitPlan) =>
				this.buildConfigs(
					accessor.get(ConfigService),
					accessor.get(BuildService),
					plan
				);
			// A JSON document is read by a program, which can't answer a question.
			const ask = !line.options.yes && !line.options.json;

			if (!line.options.json) logService.intro("rogen init");
			const planned = await initService.plan(line.positionals, { ask });
			if (planned.isErr()) return planned;
			const plan = planned.value;
			if (!plan) return err(new CancelledError("init cancelled."));

			return line.options.json
				? this.writeAsJson(initService, logService, plan, buildConfigs)
				: this.writeAsText(
						initService,
						logService,
						plan,
						cwd,
						buildConfigs
					);
		}

		/** The project file of every config the plan wrote, so `rojo serve` and the compiler have one to read. */
		private async buildConfigs(
			configService: ConfigService,
			buildService: BuildService,
			plan: InitPlan
		): Promise<Result<BuildRun, Error>> {
			// No names would select every config in the folder.
			if (plan.configs.length === 0) return ok(new BuildRun([]));
			const selection = await configService.select(plan.configs, {});
			if (selection.isErr()) return selection;
			return buildService.build(selection.value);
		}

		private async writeAsText(
			initService: InitService,
			logService: LogService,
			plan: InitPlan,
			cwd: string,
			buildConfigs: (plan: InitPlan) => Promise<Result<BuildRun, Error>>
		): Promise<Result<void, Error>> {
			// A blank gutter line sets the results apart from the last answer.
			if (plan.asked) logService.info("");
			for (const note of plan.notes) logService.info(note);
			const written = await initService.write(plan, (item) => {
				if (item.kind === "directory") {
					logService.success(`Created ${item.directory}/.`);
					return;
				}
				const { fileName, addition } = item.file;
				logService.success(
					addition !== undefined
						? `Added ${addition} to ${fileName}.`
						: `Created ${fileName}.`
				);
			});
			if (written.isErr()) return written;

			const built = await buildConfigs(plan);
			if (built.isErr()) return built;
			const log = new BuildLog(logService, cwd);
			for (const build of built.value.builds)
				log.outcome(build, foundBy(build));
			const { errors } = built.value;
			if (errors.length > 0) {
				logService.outro(
					`Wrote ${plural(plan.files.length, "file")}, but the build failed. Fix the config and run rogen build.`
				);
				return err(new ReportedError(new DiagnosticsError(errors)));
			}

			logService.step("Next steps");
			for (const line of stepLines(plan.nextSteps)) logService.info(line);
			logService.outro(`Wrote ${plural(plan.files.length, "file")}.`);
			return ok(undefined);
		}

		/** A failed write still names the files written before it, so a program knows what is on disk. */
		private async writeAsJson(
			initService: InitService,
			logService: LogService,
			plan: InitPlan,
			buildConfigs: (plan: InitPlan) => Promise<Result<BuildRun, Error>>
		): Promise<Result<void, Error>> {
			const files: string[] = [];
			const appended: string[] = [];
			const directories: string[] = [];
			const written = await initService.write(plan, (item) => {
				if (item.kind === "directory") {
					directories.push(path.join(plan.directory, item.directory));
					return;
				}
				const file = path.join(plan.directory, item.file.fileName);
				files.push(file);
				if (item.file.addition !== undefined) appended.push(file);
			});
			if (written.isErr())
				return this.printJson(
					logService,
					{
						files,
						appended,
						directories,
						error: written.error.message,
					},
					written.error
				);
			const built = await buildConfigs(plan);
			if (built.isErr())
				return this.printJson(
					logService,
					{
						files,
						appended,
						directories,
						error: built.error.message,
					},
					built.error
				);
			const report = buildReport(built.value.builds, foundBy);
			const { errors } = built.value;
			return this.printJson(
				logService,
				{
					files,
					appended,
					directories,
					built: report.configs,
					notes: plan.notes,
					nextSteps: plan.nextSteps,
				},
				DiagnosticsError.of(errors)
			);
		}
	}
);
