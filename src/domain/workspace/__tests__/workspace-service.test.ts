import { WorkspaceService, ToolchainProfile } from "../workspace-service.js";
import { RojoNode } from "../../rojo/tree.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";

describe("WorkspaceService", () => {
	let memFs: MemoryFileSystemService;
	let workspaceService: WorkspaceService;
	const cwd = "mock/workspace";

	beforeEach(async () => {
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory(cwd);
		workspaceService = new WorkspaceService(cwd, memFs);
	});

	describe("detectToolchain", () => {
		it("should return false for all flags when no marker files exist", async () => {
			const profile = await workspaceService.detectToolchain();
			expect(profile).toEqual({
				isTs: false,
				isWally: false,
				isPesde: false,
				isDarklua: false,
			});
		});

		it("should detect active toolchains based on marker files", async () => {
			await memFs.writeFile(`${cwd}/tsconfig.json`, "");
			await memFs.writeFile(`${cwd}/pesde.toml`, "");
			await memFs.writeFile(`${cwd}/.darklua.json5`, "");

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
			await memFs.writeFile(
				`${cwd}/node_modules/@rbxts/package.json`,
				""
			);
			await memFs.writeFile(
				`${cwd}/node_modules/@flamework/package.json`,
				""
			);

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
			expect(includeNode.$path).toBe("include");

			const nodeModules = includeNode.node_modules as RojoNode;
			expect(nodeModules["@rbxts"]).toEqual({
				$path: "node_modules/@rbxts",
			});
			expect(nodeModules["@flamework"]).toEqual({
				$path: "node_modules/@flamework",
			});
			expect(nodeModules["@rbxts-js"]).toBeUndefined();
		});

		it("should inject Wally packages into ReplicatedStorage and ServerScriptService", async () => {
			await memFs.createDirectory(`${cwd}/Packages`);
			await memFs.createDirectory(`${cwd}/ServerPackages`);

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
			).toEqual({ $path: "ServerPackages" });
		});

		it("should inject pesde packages into ReplicatedStorage and ServerScriptService", async () => {
			await memFs.createDirectory(`${cwd}/roblox_packages`);
			await memFs.createDirectory(`${cwd}/roblox_server_packages`);

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
			).toEqual({ $path: "roblox_server_packages" });
		});

		it("should not inject nodes if the required package folders do not physically exist on disk", async () => {
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
