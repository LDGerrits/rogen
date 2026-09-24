import path from "path";
import { ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import { detectWorkspace } from "../../domain/workspace/detect-workspace.js";
import {
	PlannedFile,
	TEMPLATE_FILE,
	parseInitName,
	planInit,
} from "../../domain/workspace/init-plan.js";
import { renderDiagnostics } from "../../platform/diagnostics/render-diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { LogService } from "../../platform/log/log-service.js";
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
		description: "Writes a starting config, detecting the toolchain.",
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

		const cwd = environmentService.cwd;
		const nameResult = parseInitName(args._.slice(1), cwd);
		if (nameResult.isErr()) {
			return err(new Error(renderDiagnostics(nameResult.error)));
		}

		const workspace = await detectWorkspace(fileSystemService, cwd);
		const plan = planInit({
			name: nameResult.value,
			workspace,
			projectName: path.basename(cwd) || DEFAULT_PROJECT_NAME,
			templateExists: await fileSystemService.exists(
				path.join(cwd, TEMPLATE_FILE)
			),
		});

		for (const { fileName } of plan.configs) {
			if (await fileSystemService.exists(path.join(cwd, fileName))) {
				return err(
					new Error(
						`${fileName} already exists in this directory. Delete it to write a new one.`
					)
				);
			}
		}

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
			logService.info(`Created ${fileName}.`);
		}

		return ok(undefined);
	},
});
