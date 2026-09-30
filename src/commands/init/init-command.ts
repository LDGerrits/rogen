import { CancelledError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { plural } from "../../base/string.js";
import { InitService, NextSteps } from "../../domain/init/init-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { ParsedArgs } from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";

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
	class InitCommand extends AbstractCommand {
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
								"The config to write. Defaults to default.",
							isOptional: true,
						},
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			args: ParsedArgs
		): Promise<Result<void, Error>> {
			const initService = accessor.get(InitService);
			const logService = accessor.get(LogService);

			logService.intro("rogen init");
			const planned = await initService.plan(args._.slice(1));
			if (planned.isErr()) return planned;
			const plan = planned.value;
			if (!plan) return err(new CancelledError("init cancelled."));

			// A blank gutter line sets the results apart from the last answer.
			if (accessor.get(PromptService).isInteractive) logService.info("");
			for (const note of plan.notes) logService.info(note);
			const written = await initService.write(plan, (fileName) =>
				logService.success(`Created ${fileName}.`)
			);
			if (written.isErr()) return written;

			logService.step("Next steps");
			for (const line of stepLines(plan.nextSteps)) logService.info(line);
			logService.outro(`Wrote ${plural(plan.files.length, "file")}.`);
			return ok(undefined);
		}
	}
);
