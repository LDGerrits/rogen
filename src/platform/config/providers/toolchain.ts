import path from "path";
import { IFileSystem } from "../../fs/file-system.js";
import { ConfigProvider, WorkspaceContext } from "../validate.js";
import { ok, Result } from "../../../base/result.js";
import { UserConfig } from "../config.js";
import { RojoTree, RojoNode } from "../../rojo/tree.js";
import { detectToolchain } from "../toolchain.js";

export const createToolchainProvider = (fs: IFileSystem): ConfigProvider => {
	return async (
		ctx: WorkspaceContext
	): Promise<Result<UserConfig, Error>> => {
		const toolchain = await detectToolchain(ctx.cwd, fs);

		const tree: RojoNode = { $className: "DataModel" };
		const template: RojoTree = {
			name: path.basename(ctx.cwd) || "roblox-game",
			tree: tree,
			globIgnorePaths: [],
		};

		if (toolchain.isTs) {
			template.globIgnorePaths!.push(
				"**/package.json",
				"**/tsconfig.json"
			);

			const hasRbxts = await fs.exists(
				path.join(ctx.cwd, "node_modules", "@rbxts")
			);
			const hasFlamework = await fs.exists(
				path.join(ctx.cwd, "node_modules", "@flamework")
			);
			const hasRbxtsJs = await fs.exists(
				path.join(ctx.cwd, "node_modules", "@rbxts-js")
			);

			const rbxtsIncludeNode: RojoNode = { $path: "include" };

			if (hasRbxts || hasFlamework || hasRbxtsJs) {
				const nodeModulesNode: RojoNode = { $className: "Folder" };
				if (hasRbxts)
					nodeModulesNode["@rbxts"] = {
						$path: "node_modules/@rbxts",
					};
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

			tree.ReplicatedStorage = {
				...((tree.ReplicatedStorage as RojoNode) || {}),
				rbxts_include: rbxtsIncludeNode,
			};
		}

		if (toolchain.isWally) {
			if (await fs.exists(path.join(ctx.cwd, "Packages"))) {
				tree.ReplicatedStorage = {
					...((tree.ReplicatedStorage as RojoNode) || {}),
					Packages: { $path: "Packages" },
				};
			}
			if (await fs.exists(path.join(ctx.cwd, "ServerPackages"))) {
				tree.ServerScriptService = {
					...((tree.ServerScriptService as RojoNode) || {}),
					ServerPackages: { $path: "ServerPackages" },
				};
			}
		}

		if (toolchain.isPesde) {
			if (await fs.exists(path.join(ctx.cwd, "roblox_packages"))) {
				tree.ReplicatedStorage = {
					...((tree.ReplicatedStorage as RojoNode) || {}),
					Packages: { $path: "roblox_packages" },
				};
			}
			if (await fs.exists(path.join(ctx.cwd, "roblox_server_packages"))) {
				tree.ServerScriptService = {
					...((tree.ServerScriptService as RojoNode) || {}),
					ServerPackages: { $path: "roblox_server_packages" },
				};
			}
		}

		return ok({ template });
	};
};
