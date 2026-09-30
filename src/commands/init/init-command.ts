import { ok, err } from "../../base/result.js";
import { CancelledError } from "../../base/errors.js";
import { InitService, NextSteps } from "../../domain/init/init-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";

const indent = (line: string) => `  ${line}`;

/** The next steps as printed: long-running commands grouped, since each keeps its terminal busy. */
const renderSteps = ({ setup, run, darklua, edits }: NextSteps): string[] => [
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

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "init",
	metadata: {
		description:
			"Writes a starting config, detecting the workspace and asking in a terminal.",
		args: [
			{
				name: "name",
				description: "The config to write. Defaults to default.",
				isOptional: true,
			},
		],
	},
	handler: async (accessor, args) => {
		const initService = accessor.get(InitService);
		const logService = accessor.get(LogService);
		const promptService = accessor.get(PromptService);

		const directory = await initService.prepare(args._.slice(1));
		if (directory.isErr()) return directory;

		logService.intro("rogen init");
		const planned = await initService.plan(directory.value);
		if (planned.isErr()) return planned;
		const plan = planned.value;
		if (!plan) return err(new CancelledError("init cancelled."));

		// A blank gutter line sets the results apart from the last answer.
		if (promptService.isInteractive) logService.info("");
		for (const note of plan.notes) logService.info(note);
		const written = await initService.write(plan, (fileName) =>
			logService.success(`Created ${fileName}.`)
		);
		if (written.isErr()) return written;

		logService.step("Next steps");
		for (const line of renderSteps(plan.nextSteps)) logService.info(line);
		const count = plan.files.length;
		logService.outro(`Wrote ${count} ${count === 1 ? "file" : "files"}.`);
		return ok(undefined);
	},
});
