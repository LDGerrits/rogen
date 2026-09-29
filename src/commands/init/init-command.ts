import path from "path";
import { ok, err } from "../../base/result.js";
import { CancelledError, ErrorUtils } from "../../base/errors.js";
import { planInit, prepareInit } from "../../domain/init/plan-init.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
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
		const environmentService = accessor.get(EnvironmentService);
		const fileSystemService = accessor.get(FileSystemService);
		const logService = accessor.get(LogService);
		const promptService = accessor.get(PromptService);

		const cwd = environmentService.cwd;
		const request = await prepareInit(
			fileSystemService,
			cwd,
			args._.slice(1)
		);
		if (request.isErr()) return request;

		logService.intro("rogen init");
		const planned = await planInit(
			fileSystemService,
			promptService,
			request.value
		);
		if (planned.isErr()) return err(new DiagnosticsError(planned.error));
		const plan = planned.value;
		if (!plan) return err(new CancelledError("init cancelled."));

		const files = [
			...(plan.template ? [plan.template] : []),
			...plan.configs,
			...plan.compilerConfigs,
		];
		// A blank gutter line sets the results apart from the last answer.
		if (promptService.isInteractive) logService.info("");
		for (const note of plan.notes) logService.info(note);
		for (const { fileName, content } of files) {
			try {
				await fileSystemService.writeFile(
					path.join(cwd, fileName),
					content
				);
			} catch (error) {
				return err(
					new Error(
						`Failed to write ${fileName}: ${ErrorUtils.fromUnknown(error).message}`,
						{ cause: error }
					)
				);
			}
			logService.success(`Created ${fileName}.`);
		}

		logService.step("Next steps");
		for (const line of renderSteps(plan.nextSteps)) logService.info(line);
		logService.outro(
			`Wrote ${files.length} ${files.length === 1 ? "file" : "files"}.`
		);
		return ok(undefined);
	},
});
