import { ok, err } from "../../base/result.js";
import { CancelledError } from "../../base/errors.js";
import { plannedFiles } from "../../domain/init/init-plan.js";
import { InitService } from "../../domain/init/init-service.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { LogService } from "../../platform/log/log-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { renderSteps } from "./render-steps.js";

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

		const request = await initService.prepare(args._.slice(1));
		if (request.isErr()) return request;

		logService.intro("rogen init");
		const planned = await initService.plan(request.value);
		if (planned.isErr()) return err(new DiagnosticsError(planned.error));
		const plan = planned.value;
		if (!plan) return err(new CancelledError("init cancelled."));

		// A blank gutter line sets the results apart from the last answer.
		if (promptService.isInteractive) logService.info("");
		for (const note of plan.notes) logService.info(note);
		const written = await initService.write(
			request.value,
			plan,
			(fileName) => logService.success(`Created ${fileName}.`)
		);
		if (written.isErr()) return written;

		logService.step("Next steps");
		for (const line of renderSteps(plan.nextSteps)) logService.info(line);
		const count = plannedFiles(plan).length;
		logService.outro(`Wrote ${count} ${count === 1 ? "file" : "files"}.`);
		return ok(undefined);
	},
});
