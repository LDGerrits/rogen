import path from "path";
import { ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import { detectWorkspace } from "../../domain/workspace/detect-workspace.js";
import {
	PlannedFile,
	parseInitName,
	planInit,
} from "../../domain/workspace/init-plan.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
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

		const nameResult = parseInitName(args._.slice(1));
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

		const planned = planInit({
			name: nameResult.value,
			workspace: await detectWorkspace(fileSystemService, cwd),
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
			logService.info(`Created ${fileName}.`);
		}

		return ok(undefined);
	},
});
