import path from "path";
import { CancelledError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { plural } from "../../base/strings.js";
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
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";

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
		? ["Run each in its own terminal:", ...run.map(indent)]
		: []),
	...(darklua.length > 0
		? [
				"Have Darklua process your code into the sync dir:",
				...darklua.map(indent),
			]
		: []),
	...edits,
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
								"The config to write. Defaults to default. Beside an existing default.rogen.json, a run that doesn't ask adds it as a place in places/<name>.",
							isOptional: true,
						},
					],
					options: InitOptions,
					examples: ["rogen init", "rogen init lobby", "rogen init -y"],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof InitOptions>
		): Promise<Result<void, Error>> {
			const initService = accessor.get(InitService);
			const logService = accessor.get(LogService);
			// A JSON document is read by a program, which can't answer a question.
			const ask = !line.options.yes && !line.options.json;

			if (!line.options.json) logService.intro("rogen init");
			const planned = await initService.plan(line.positionals, { ask });
			if (planned.isErr()) return planned;
			const plan = planned.value;
			if (!plan) return err(new CancelledError("init cancelled."));

			return line.options.json
				? this.writeAsJson(initService, logService, plan)
				: this.writeAsText(initService, logService, plan);
		}

		private async writeAsText(
			initService: InitService,
			logService: LogService,
			plan: InitPlan
		): Promise<Result<void, Error>> {
			// A blank gutter line sets the results apart from the last answer.
			if (plan.asked) logService.info("");
			for (const note of plan.notes) logService.info(note);
			const written = await initService.write(
				plan,
				({ fileName, appends }) =>
					logService.success(
						appends
							? `Added Rogen's rules to ${fileName}.`
							: `Created ${fileName}.`
					)
			);
			if (written.isErr()) return written;

			logService.step("Next steps");
			for (const line of stepLines(plan.nextSteps)) logService.info(line);
			logService.outro(`Wrote ${plural(plan.files.length, "file")}.`);
			return ok(undefined);
		}

		/** A failed write still names the files written before it, so a program knows what is on disk. */
		private async writeAsJson(
			initService: InitService,
			logService: LogService,
			plan: InitPlan
		): Promise<Result<void, Error>> {
			const files: string[] = [];
			const appended: string[] = [];
			const written = await initService.write(
				plan,
				({ fileName, appends }) => {
					const file = path.join(plan.directory, fileName);
					files.push(file);
					if (appends) appended.push(file);
				}
			);
			if (written.isErr())
				return this.printJson(
					logService,
					{ files, appended, error: written.error.message },
					written.error
				);
			return this.printJson(logService, {
				files,
				appended,
				notes: plan.notes,
				nextSteps: plan.nextSteps,
			});
		}
	}
);
