import path from "path";
import { ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import { detectWorkspace } from "../../domain/workspace/detect-workspace.js";
import { askInitChoices } from "../../domain/workspace/init-questions.js";
import {
	PlannedFile,
	defaultInitChoices,
	parseInitName,
	planInit,
} from "../../domain/workspace/init-plan.js";
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

const DEFAULT_PROJECT_NAME = "roblox-game";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "init",
	metadata: {
		description:
			"Writes a starting config, detecting the toolchain and asking in a terminal.",
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

		const names = args._.slice(1);
		const nameResult = parseInitName(names);
		if (nameResult.isErr()) return nameResult;

		const cwd = environmentService.cwd;
		let existingFiles: ReadonlySet<string>;
		try {
			existingFiles = new Set(
				(await fileSystemService.readDirectory(cwd)).map(
					([name]) => name
				)
			);
		} catch (error) {
			return err(
				new Error(
					`Failed to read ${cwd}: ${ErrorUtils.fromUnknown(error).message}`,
					{ cause: error }
				)
			);
		}

		const workspace = await detectWorkspace(fileSystemService, cwd);
		logService.intro("rogen init");
		const choices = promptService.isInteractive
			? await askInitChoices(
					promptService,
					workspace,
					names.length > 0 ? nameResult.value : undefined
				)
			: defaultInitChoices(workspace, nameResult.value);
		if (!choices) return err(new Error("init cancelled."));

		const planned = planInit({
			choices,
			projectName: path.basename(cwd) || DEFAULT_PROJECT_NAME,
			directory: cwd,
			existingFiles,
		});
		if (planned.isErr()) return err(new DiagnosticsError(planned.error));
		const plan = planned.value;

		const files: PlannedFile[] = [
			...(plan.template ? [plan.template] : []),
			...plan.configs,
		];
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

		logService.outro(
			`Wrote ${files.length} ${files.length === 1 ? "file" : "files"}.`
		);
		return ok(undefined);
	},
});
