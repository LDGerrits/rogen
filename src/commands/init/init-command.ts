import path from "path";
import { Command } from "../command.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Result, ok, err } from "../../base/result.js";
import { mergeDeep } from "../../base/object.js";
import { defaultConfig } from "../../domain/config/config.js";
import { ErrorUtils } from "../../base/errors.js";
import { RojoNode } from "../../domain/rojo/rojo-project.js";
import { WorkspaceService } from "../../domain/workspace/workspace-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";

export class InitCommand implements Command {
	constructor(
		private readonly NativeEnvironmentService: EnvironmentService,
		private readonly fileSystemService: FileSystemService,
		private readonly workspaceService: WorkspaceService,
		private readonly logService: LogService
	) {}

	async execute(): Promise<Result<void, Error>> {
		const cwd = this.NativeEnvironmentService.cwd;
		const targetPath = path.resolve(cwd, ".rogen.json");

		if (await this.fileSystemService.exists(targetPath)) {
			return err(
				new Error(
					"A .rogen.json file already exists in this directory."
				)
			);
		}

		const toolchain = await this.workspaceService.detectToolchain();
		const baseTreeNode: RojoNode = { $className: "DataModel" };

		await this.workspaceService.injectPackages(baseTreeNode, toolchain);

		const smartConfig = mergeDeep<Record<string, unknown>>(defaultConfig, {
			template: {
				name: path.basename(cwd) || "roblox-game",
				tree: baseTreeNode,
				globIgnorePaths: toolchain.isTs
					? ["**/package.json", "**/tsconfig.json"]
					: [],
			},
		});

		// Prune config
		if (toolchain.isTs) delete smartConfig.luau;
		else delete smartConfig.ts;
		if (!toolchain.isDarklua) delete smartConfig.darklua;

		delete smartConfig.globIgnorePaths;
		delete smartConfig.aliases;
		delete smartConfig.verbatim;
		delete smartConfig.casing;
		delete smartConfig.unwrap;

		const content = JSON.stringify(smartConfig, null, "\t");

		// Write to disk
		try {
			await this.fileSystemService.writeFile(targetPath, content);
		} catch (error) {
			return err(
				new Error(
					`Failed to write .rogen.json: ${ErrorUtils.fromUnknown(error).message}`
				)
			);
		}

		this.logService.info(
			"Successfully created .rogen.json in the current directory."
		);

		return ok(undefined);
	}
}
