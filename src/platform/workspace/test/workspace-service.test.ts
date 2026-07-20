import { jest } from "@jest/globals";
import { WorkspaceService, ToolchainProfile } from "../workspace-service.js";
import { FileSystemService } from "../../fs/file-system-service.js";
import { RojoNode } from "../../rojo/tree.js";

describe("WorkspaceService", () => {
	let mockFs: jest.Mocked<FileSystemService>;
	let workspaceService: WorkspaceService;
	const cwd = "/mock/workspace";

	beforeEach(() => {
		mockFs = {
			exists: jest.fn(),
		} as unknown as jest.Mocked<FileSystemService>;
		workspaceService = new WorkspaceService(cwd, mockFs);
	});

	describe("detectToolchain", () => {
		it("should return false for all flags when no marker files exist", async () => {
			mockFs.exists.mockResolvedValue(false);

			const profile = await workspaceService.detectToolchain();

			expect(profile).toEqual({
				isTs: false,
				isWally: false,
				isPesde: false,
				isDarklua: false,
			});
		});

		it("should detect active toolchains based on marker files", async () => {
			mockFs.exists.mockImplementation(async (p) => {
				const pathStr = String(p);
				return (
					pathStr.endsWith("tsconfig.json") ||
					pathStr.endsWith("pesde.toml") ||
					pathStr.endsWith(".darklua.json5")
				);
			});

			const profile = await workspaceService.detectToolchain();

			expect(profile.isTs).toBe(true);
			expect(profile.isPesde).toBe(true);
			expect(profile.isDarklua).toBe(true);
			expect(profile.isWally).toBe(false);
		});
	});

	describe("injectPackages", () => {
		let rootNode: RojoNode;

		beforeEach(() => {
			rootNode = { $className: "DataModel" };
		});

		it("should inject TS node_modules into ReplicatedStorage when present", async () => {
			mockFs.exists.mockImplementation(async (p) => {
				const pathStr = String(p);
				return (
					pathStr.endsWith("@rbxts") || pathStr.endsWith("@flamework")
				);
			});

			const toolchain: ToolchainProfile = {
				isTs: true,
				isWally: false,
				isPesde: false,
				isDarklua: false,
			};

			await workspaceService.injectPackages(rootNode, toolchain);

			const replicatedStorage = rootNode.ReplicatedStorage as RojoNode;
			expect(replicatedStorage).toBeDefined();

			const includeNode = replicatedStorage.rbxts_include as RojoNode;
			expect(includeNode).toBeDefined();
			expect(includeNode.$path).toBe("include");

			const nodeModules = includeNode.node_modules as RojoNode;
			expect(nodeModules).toBeDefined();
			expect(nodeModules["@rbxts"]).toEqual({
				$path: "node_modules/@rbxts",
			});
			expect(nodeModules["@flamework"]).toEqual({
				$path: "node_modules/@flamework",
			});
			expect(nodeModules["@rbxts-js"]).toBeUndefined();
		});

		it("should inject Wally packages into ReplicatedStorage and ServerScriptService", async () => {
			mockFs.exists.mockImplementation(async (p) => {
				const pathStr = String(p);
				return (
					pathStr.endsWith("Packages") ||
					pathStr.endsWith("ServerPackages")
				);
			});

			const toolchain: ToolchainProfile = {
				isTs: false,
				isWally: true,
				isPesde: false,
				isDarklua: false,
			};

			await workspaceService.injectPackages(rootNode, toolchain);

			expect((rootNode.ReplicatedStorage as RojoNode).Packages).toEqual({
				$path: "Packages",
			});
			expect(
				(rootNode.ServerScriptService as RojoNode).ServerPackages
			).toEqual({
				$path: "ServerPackages",
			});
		});

		it("should inject pesde packages into ReplicatedStorage and ServerScriptService", async () => {
			mockFs.exists.mockImplementation(async (p) => {
				const pathStr = String(p);
				return (
					pathStr.endsWith("roblox_packages") ||
					pathStr.endsWith("roblox_server_packages")
				);
			});

			const toolchain: ToolchainProfile = {
				isTs: false,
				isWally: false,
				isPesde: true,
				isDarklua: false,
			};

			await workspaceService.injectPackages(rootNode, toolchain);

			expect((rootNode.ReplicatedStorage as RojoNode).Packages).toEqual({
				$path: "roblox_packages",
			});
			expect(
				(rootNode.ServerScriptService as RojoNode).ServerPackages
			).toEqual({
				$path: "roblox_server_packages",
			});
		});

		it("should not inject nodes if the required package folders do not physically exist on disk", async () => {
			mockFs.exists.mockResolvedValue(false);

			const toolchain: ToolchainProfile = {
				isTs: true,
				isWally: true,
				isPesde: true,
				isDarklua: false,
			};

			await workspaceService.injectPackages(rootNode, toolchain);

			expect(
				(rootNode.ReplicatedStorage as RojoNode).rbxts_include
			).toBeDefined();
			expect(
				(
					(rootNode.ReplicatedStorage as RojoNode)
						.rbxts_include as RojoNode
				).node_modules
			).toBeUndefined();

			expect(
				(rootNode.ReplicatedStorage as RojoNode).Packages
			).toBeUndefined();
			expect(rootNode.ServerScriptService as RojoNode).toBeUndefined();
		});
	});
});
