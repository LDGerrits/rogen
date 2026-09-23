import path from "path";
import { Command } from "../command.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Result, ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import { RojoNode, RojoTree } from "../../domain/rojo/rojo-project.js";
import { WorkspaceService } from "../../domain/workspace/workspace-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { RogenConfig } from "../../domain/config/config.js";

const STARTING_ROUTES: Record<string, string> = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

export class InitCommand implements Command {
	constructor(
		private readonly environmentService: EnvironmentService,
		private readonly fileSystemService: FileSystemService,
		private readonly workspaceService: WorkspaceService,
		private readonly logService: LogService
	) {}

	async execute(): Promise<Result<void, Error>> {
		const cwd = this.environmentService.cwd;
		const configPath = path.resolve(cwd, "default.rogen.json");

		if (await this.fileSystemService.exists(configPath)) {
			return err(
				new Error(
					"A default.rogen.json file already exists in this directory."
				)
			);
		}

		const toolchain = await this.workspaceService.detectToolchain();

		const baseTreeNode: RojoNode = { $className: "DataModel" };
		await this.workspaceService.injectPackages(baseTreeNode, toolchain);

		// A bare DataModel is the default anyway, so only write a template with mounts.
		const hasPackageMounts = Object.keys(baseTreeNode).length > 1;

		const config: RogenConfig = {
			$schema: "https://rogen.dev/schema/2/rogen.json",
			rootDirs: ["src"],
			routes: STARTING_ROUTES,
			...(hasPackageMounts ? { template: "base.project.json" } : {}),
		};

		// TODO: set `syncDir` from the compiler's output dir.

		try {
			if (hasPackageMounts) {
				const template: RojoTree = {
					name: path.basename(cwd) || "roblox-game",
					tree: baseTreeNode,
				};
				await this.fileSystemService.writeFile(
					path.resolve(cwd, "base.project.json"),
					JSON.stringify(template, null, "\t")
				);
			}

			await this.fileSystemService.writeFile(
				configPath,
				JSON.stringify(config, null, "\t")
			);
		} catch (error) {
			return err(
				new Error(
					`Failed to write default.rogen.json: ${ErrorUtils.fromUnknown(error).message}`
				)
			);
		}

		this.logService.info(
			"Successfully created default.rogen.json in the current directory."
		);

		return ok(undefined);
	}
}
