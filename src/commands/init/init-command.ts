import path from "path";
import { ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import { RojoNode, RojoTree } from "../../domain/rojo/rojo-project.js";
import { WorkspaceService } from "../../domain/workspace/workspace-service.js";
import { RogenConfig } from "../../domain/config/config.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";

const STARTING_ROUTES: Record<string, string> = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "init",
	metadata: {
		description: "Writes a starting config, detecting the toolchain.",
		args: [
			{
				name: "name",
				description: "The config to write.",
				isOptional: true,
			},
		],
	},
	handler: async (accessor) => {
		const environmentService = accessor.get(EnvironmentService);
		const fileSystemService = accessor.get(FileSystemService);
		const workspaceService = accessor.get(WorkspaceService);
		const logService = accessor.get(LogService);

		const cwd = environmentService.cwd;
		const configPath = path.resolve(cwd, "default.rogen.json");

		if (await fileSystemService.exists(configPath)) {
			return err(
				new Error(
					"A default.rogen.json file already exists in this directory."
				)
			);
		}

		const toolchain = await workspaceService.detectToolchain();

		const baseTreeNode: RojoNode = { $className: "DataModel" };
		await workspaceService.injectPackages(baseTreeNode, toolchain);

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
				await fileSystemService.writeFile(
					path.resolve(cwd, "base.project.json"),
					JSON.stringify(template, null, "\t")
				);
			}

			await fileSystemService.writeFile(
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

		logService.info(
			"Successfully created default.rogen.json in the current directory."
		);

		return ok(undefined);
	},
});
