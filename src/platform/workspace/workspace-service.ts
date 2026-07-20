import path from "path";
import { FileSystemService } from "../fs/file-system-service.js";
import { RojoNode } from "../rojo/tree.js";

export interface ToolchainProfile {
	isTs: boolean;
	isWally: boolean;
	isPesde: boolean;
	isDarklua: boolean;
}

export class WorkspaceService {
	constructor(
		private readonly cwd: string,
		private readonly fileSystem: FileSystemService
	) {}

	async detectToolchain(): Promise<ToolchainProfile> {
		const [isTs, isWally, isPesde, hasDarkluaJson, hasDarkluaJson5] =
			await Promise.all([
				this.fileSystem.exists(path.join(this.cwd, "tsconfig.json")),
				this.fileSystem.exists(path.join(this.cwd, "wally.toml")),
				this.fileSystem.exists(path.join(this.cwd, "pesde.toml")),
				this.fileSystem.exists(path.join(this.cwd, ".darklua.json")),
				this.fileSystem.exists(path.join(this.cwd, ".darklua.json5")),
			]);

		return {
			isTs,
			isWally,
			isPesde,
			isDarklua: hasDarkluaJson || hasDarkluaJson5,
		};
	}

	async injectPackages(
		rootNode: RojoNode,
		toolchain: ToolchainProfile
	): Promise<void> {
		if (toolchain.isTs) {
			const [hasRbxts, hasFlamework, hasRbxtsJs] = await Promise.all([
				this.fileSystem.exists(
					path.join(this.cwd, "node_modules", "@rbxts")
				),
				this.fileSystem.exists(
					path.join(this.cwd, "node_modules", "@flamework")
				),
				this.fileSystem.exists(
					path.join(this.cwd, "node_modules", "@rbxts-js")
				),
			]);

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

			rootNode.ReplicatedStorage = {
				...((rootNode.ReplicatedStorage as RojoNode) || {}),
				rbxts_include: rbxtsIncludeNode,
			};
		}

		if (toolchain.isWally) {
			if (await this.fileSystem.exists(path.join(this.cwd, "Packages"))) {
				rootNode.ReplicatedStorage = {
					...((rootNode.ReplicatedStorage as RojoNode) || {}),
					Packages: { $path: "Packages" },
				};
			}
			if (
				await this.fileSystem.exists(
					path.join(this.cwd, "ServerPackages")
				)
			) {
				rootNode.ServerScriptService = {
					...((rootNode.ServerScriptService as RojoNode) || {}),
					ServerPackages: { $path: "ServerPackages" },
				};
			}
		}

		if (toolchain.isPesde) {
			if (
				await this.fileSystem.exists(
					path.join(this.cwd, "roblox_packages")
				)
			) {
				rootNode.ReplicatedStorage = {
					...((rootNode.ReplicatedStorage as RojoNode) || {}),
					Packages: { $path: "roblox_packages" },
				};
			}
			if (
				await this.fileSystem.exists(
					path.join(this.cwd, "roblox_server_packages")
				)
			) {
				rootNode.ServerScriptService = {
					...((rootNode.ServerScriptService as RojoNode) || {}),
					ServerPackages: { $path: "roblox_server_packages" },
				};
			}
		}
	}
}
