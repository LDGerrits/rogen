import { FileSystemService } from "../fs/file-system-service.js";
import { RojoNode } from "./tree.js";
import { ToolchainProfile } from "../config/toolchain.js";
import path from "path";

export async function injectWorkspacePackages(
	rootNode: RojoNode,
	toolchain: ToolchainProfile,
	cwd: string,
	fileSystemService: FileSystemService
): Promise<void> {
	if (toolchain.isTs) {
		const [hasRbxts, hasFlamework, hasRbxtsJs] = await Promise.all([
			fileSystemService.exists(path.join(cwd, "node_modules", "@rbxts")),
			fileSystemService.exists(
				path.join(cwd, "node_modules", "@flamework")
			),
			fileSystemService.exists(
				path.join(cwd, "node_modules", "@rbxts-js")
			),
		]);

		const rbxtsIncludeNode: RojoNode = { $path: "include" };

		if (hasRbxts || hasFlamework || hasRbxtsJs) {
			const nodeModulesNode: RojoNode = { $className: "Folder" };
			if (hasRbxts)
				nodeModulesNode["@rbxts"] = { $path: "node_modules/@rbxts" };
			if (hasFlamework)
				nodeModulesNode["@flamework"] = {
					$path: "node_modules/@flamework",
				};
			if (hasRbxtsJs)
				nodeModulesNode["@rbxts-js"] = {
					$path: "node_modules/@rbxts-js",
				};

			rbxtsIncludeNode.node_modules = nodeModulesNode;
		}

		rootNode.ReplicatedStorage = {
			...((rootNode.ReplicatedStorage as RojoNode) || {}),
			rbxts_include: rbxtsIncludeNode,
		};
	}

	if (toolchain.isWally) {
		if (await fileSystemService.exists(path.join(cwd, "Packages"))) {
			rootNode.ReplicatedStorage = {
				...((rootNode.ReplicatedStorage as RojoNode) || {}),
				Packages: { $path: "Packages" },
			};
		}
		if (await fileSystemService.exists(path.join(cwd, "ServerPackages"))) {
			rootNode.ServerScriptService = {
				...((rootNode.ServerScriptService as RojoNode) || {}),
				ServerPackages: { $path: "ServerPackages" },
			};
		}
	}

	if (toolchain.isPesde) {
		if (await fileSystemService.exists(path.join(cwd, "roblox_packages"))) {
			rootNode.ReplicatedStorage = {
				...((rootNode.ReplicatedStorage as RojoNode) || {}),
				Packages: { $path: "roblox_packages" },
			};
		}
		if (
			await fileSystemService.exists(
				path.join(cwd, "roblox_server_packages")
			)
		) {
			rootNode.ServerScriptService = {
				...((rootNode.ServerScriptService as RojoNode) || {}),
				ServerPackages: { $path: "roblox_server_packages" },
			};
		}
	}
}
