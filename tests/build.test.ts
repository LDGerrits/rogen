import fs from "fs";
import { build } from "../src/build.js";
import { CliArgs, Environment, RogenConfig, RogenMode, RojoTree } from "../src/types.js";
import { jest } from "@jest/globals";
import path from "path";
import { execute } from "../src/execute.js";

describe("Builder Integration", () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it("should successfully build a tree and ignore non-Roblox files", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");
			
			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "systems", isDirectory: () => true, isFile: () => false },
					{ name: "ui", isDirectory: () => true, isFile: () => false },
					{ name: "ignoreMe.png", isDirectory: () => false, isFile: () => true },
					{ name: "Weapon.rbxm", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}
			
			if (normalizedDir.endsWith("systems")) {
				return [
					{ name: "Combat.server.lua", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("ui")) {
				return [
					{ name: "init.lua", isDirectory: () => false, isFile: () => true },
					{ name: "Button.lua", isDirectory: () => false, isFile: () => true } 
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "src" };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["src"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(3); 
		
		expect(result.name).toBe("test-game");
		expect(result.buildDir).toBe("out");
		expect(result.output).toBe(path.resolve(process.cwd(), "test.project.json"));

		expect(resultTree.ServerScriptService.server.systems.Combat).toBeDefined();
		expect(resultTree.ServerScriptService.server.systems.Combat.$path).toBe("out/systems/Combat.server.lua");

		expect(resultTree.ReplicatedStorage.shared.Weapon).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.Weapon.$path).toBe("out/Weapon.rbxm");

		expect(resultTree.ReplicatedStorage.shared.ui).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.ui.$path).toBe("out/ui");
	});

	it("should successfully merge files from multiple source directories into single containers", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");
			
			if (normalizedDir.endsWith("src/core")) {
				return [
					{ name: "CoreMath.lua", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}
			
			if (normalizedDir.endsWith("src/chapter1")) {
				return [
					{ name: "LevelData.lua", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: ["src/core", "src/chapter1"] };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["src/core", "src/chapter1"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2); 

		expect(resultTree.ReplicatedStorage.shared.CoreMath).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.LevelData).toBeDefined();
		
		expect(resultTree.ReplicatedStorage.shared.CoreMath.$path).toBe("out/core/CoreMath.lua");
		expect(resultTree.ReplicatedStorage.shared.LevelData.$path).toBe("out/chapter1/LevelData.lua");
	});

	it("should treat a source reached via parent-dir navigation as a root without corrupting the build path", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "Combat.lua", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "../../src" };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["../../src"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		expect(resultTree.ReplicatedStorage.shared.Combat.$path).toBe("out/Combat.lua");
	});

	it("should compile TypeScript sources to .luau paths when the environment is a TS project", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "Weapon.ts", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "src" };
		const env: Environment = { isTsProject: true, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["src"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		expect(resultTree.ReplicatedStorage.shared.Weapon.$path).toBe("out/Weapon.luau");
	});


	it("should route files based on marker files instead of folder names", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");
			
			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "Database", isDirectory: () => true, isFile: () => false },
				] as fs.Dirent[];
			}
			
			if (normalizedDir.endsWith("Database")) {
				return [
					{ name: ".server", isDirectory: () => false, isFile: () => true },
					{ name: "query.lua", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "src" };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["src"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(1); 
		
		expect(resultTree.ServerScriptService.server.Database.query).toBeDefined();
		expect(resultTree.ServerScriptService.server.Database.query.$path).toBe("out/Database/query.lua");
	});

	it("should generate PascalCase tree names without changing source paths", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "features", isDirectory: () => true, isFile: () => false }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("features")) {
				return [
					{ name: "test", isDirectory: () => true, isFile: () => false }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("test")) {
				return [
					{ name: "testServiceUtils.luau", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "src", casing: "PascalCase" };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };

		const result = await build(targetConfig, baseTree, config, env, ["src"], {}, process.cwd());
		const node = (result.tree.tree as any).ReplicatedStorage.Shared.features.test.testServiceUtils;

		expect(node).toBeDefined();
		expect(node.$path).toBe("out/features/test/testServiceUtils.luau");
	});

	it("should generate camelCase tree names by default without changing source paths", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "Features", isDirectory: () => true, isFile: () => false }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("Features")) {
				return [
					{ name: "Test", isDirectory: () => true, isFile: () => false }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("Test")) {
				return [
					{ name: "TestServiceUtils.luau", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "src" };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };

		const result = await build(targetConfig, baseTree, config, env, ["src"], {}, process.cwd());
		const node = (result.tree.tree as any).ReplicatedStorage.shared.Features.Test.TestServiceUtils;

		expect(node).toBeDefined();
		expect(node.$path).toBe("out/Features/Test/TestServiceUtils.luau");
	});

	it("should resolve CLI output relative to cwd, but config output relative to anchor", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(false); 

		const targetConfig = { build: "out", output: "from-config.json" };
		const baseTree = { name: "test", tree: {} };
		const config = { source: "src" };
		const env = { isTsProject: false, isDarkluaProject: false };
		const anchor = "/mock/custom/anchor/path";

		const resultA = await build(targetConfig, baseTree, config, env, ["src"], {}, anchor);

		const expectedConfigPath = path.resolve(anchor, "from-config.json").replace(/\\/g, "/");
		expect(resultA.output.replace(/\\/g, "/")).toBe(expectedConfigPath);

		const cliArgs = { output: "from-cli.json" };
		const resultB = await build(targetConfig, baseTree, config, env, ["src"], cliArgs, anchor);
		
		const expectedCliPath = path.resolve(process.cwd(), "from-cli.json").replace(/\\/g, "/");
		expect(resultB.output.replace(/\\/g, "/")).toBe(expectedCliPath);
	});

	it("should create a directory for missing extensionless paths instead of dropping them", async () => {
		jest.spyOn(fs, "existsSync").mockImplementation((p) => {
			const pathStr = String(p).replace(/\\/g, "/");

			if (pathStr.endsWith("test.json")) return false;
			
			if (pathStr.includes("out/MissingInitFolder")) return false;

			return true;
		});

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");
			if (normalizedDir.endsWith("src")) {
				return [{ name: "MissingInitFolder", isDirectory: () => true, isFile: () => false }];
			}
			if (normalizedDir.endsWith("MissingInitFolder")) {
				return [{ name: "init.lua", isDirectory: () => false, isFile: () => true }];
			}
			return [];
		});

		const mkdirSpy = jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as any);
		const writeSpy = jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined as any);

		const dummyEnv = { isTsProject: false, isDarkluaProject: false };
		const dummyConfig = { source: "src", luau: { output: "test.json", build: "out" } };
		const baseTree = { name: "test", tree: {} };
		const anchor = process.cwd();

		await execute(["src"], dummyEnv, [dummyConfig.luau], baseTree, dummyConfig, {}, anchor);

		const expectedDirPath = path.resolve(anchor, "out/MissingInitFolder");

		expect(mkdirSpy).toHaveBeenCalledWith(expectedDirPath, { recursive: true });
		expect(writeSpy).not.toHaveBeenCalledWith(expectedDirPath, "");
	});

	it("should support Argon and Rojo data file types (JSON, TOML, YAML, CSV, etc.)", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "config.toml", isDirectory: () => false, isFile: () => true },
					{ name: "data.json", isDirectory: () => false, isFile: () => true },
					{ name: "locales.csv", isDirectory: () => false, isFile: () => true },
					{ name: "notes.txt", isDirectory: () => false, isFile: () => true },
					{ name: "README.md", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "src" };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["src"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(5);

		expect(resultTree.ReplicatedStorage.shared.config.$path).toBe("out/config.toml");
		expect(resultTree.ReplicatedStorage.shared.data.$path).toBe("out/data.json");
		expect(resultTree.ReplicatedStorage.shared.locales.$path).toBe("out/locales.csv");
		expect(resultTree.ReplicatedStorage.shared.notes.$path).toBe("out/notes.txt");
		expect(resultTree.ReplicatedStorage.shared.README.$path).toBe("out/README.md");
	});

	it("should create empty folders for directories containing .gitkeep or .keep files", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "EmptyFeatureA", isDirectory: () => true, isFile: () => false },
					{ name: "EmptyFeatureB", isDirectory: () => true, isFile: () => false },
					{ name: "IgnoredFeatureC", isDirectory: () => true, isFile: () => false }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("EmptyFeatureA")) {
				return [
					{ name: ".gitkeep", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("EmptyFeatureB")) {
				return [
					{ name: ".keep", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("IgnoredFeatureC")) {
				return [
					{ name: "ignoreMe.pdf", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "src" };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["src"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2);

		expect(resultTree.ReplicatedStorage.shared.EmptyFeatureA).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.EmptyFeatureA.$className).toBe("Folder");
		expect(resultTree.ReplicatedStorage.shared.EmptyFeatureA.$path).toBeUndefined();

		expect(resultTree.ReplicatedStorage.shared.EmptyFeatureB).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.EmptyFeatureB.$className).toBe("Folder");
		expect(resultTree.ReplicatedStorage.shared.EmptyFeatureB.$path).toBeUndefined();

		expect(resultTree.ReplicatedStorage.shared.IgnoredFeatureC).toBeUndefined();
	});

	it("should completely halt routing logic when encountering a .raw marker file", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");
			
			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "vendor", isDirectory: () => true, isFile: () => false },
				] as fs.Dirent[];
			}
			
			if (normalizedDir.endsWith("vendor")) {
				return [
					{ name: ".raw", isDirectory: () => false, isFile: () => true },
					{ name: "main.server.lua", isDirectory: () => false, isFile: () => true },
					{ name: "Client", isDirectory: () => true, isFile: () => false }
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("Client")) {
				return [
					{ name: "apiClient.lua", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: RogenConfig = { source: "src" };
		const env: Environment = { isTsProject: false, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["src"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2); 

		const vendorFolder = resultTree.ReplicatedStorage.shared.vendor;
		expect(vendorFolder).toBeDefined();

		expect(vendorFolder["main.server"]).toBeDefined();
		expect(vendorFolder["main.server"].$path).toBe("out/vendor/main.server.lua");

		expect(vendorFolder.Client["apiClient"]).toBeDefined();
		expect(vendorFolder.Client["apiClient"].$path).toBe("out/vendor/Client/apiClient.lua");
		
		expect(resultTree.ServerScriptService).toBeUndefined();
		expect(resultTree.StarterPlayerScripts).toBeUndefined();
	});

	it("should preserve routing keywords in file names when encountering a .fullnames marker", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs.promises, "readdir") as jest.Mock<(dir: string) => Promise<any[]>>).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");
			
			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "systems", isDirectory: () => true, isFile: () => false },
				] as fs.Dirent[];
			}
			
			if (normalizedDir.endsWith("systems")) {
				return [
					{ name: ".fullnames", isDirectory: () => false, isFile: () => true },
					{ name: "combatServer.lua", isDirectory: () => false, isFile: () => true },
					{ name: "combat.client.lua", isDirectory: () => false, isFile: () => true }
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: RogenMode = { build: "out", output: "test.project.json" };
		const baseTree: RojoTree = { name: "test-game", tree: {} };

		const config: RogenConfig = { source: "src", fullNames: false }; 
		const env: Environment = { isTsProject: false, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(targetConfig, baseTree, config, env, ["src"], cliArgs, process.cwd());
		const resultTree = result.tree.tree as any;

		const serverSystems = resultTree.ServerScriptService.server.systems;
		expect(serverSystems).toBeDefined();
		
		expect(serverSystems["combatServer"]).toBeDefined();
		expect(serverSystems["combatServer"].$path).toBe("out/systems/combatServer.lua");

		const clientSystems = resultTree.StarterPlayer.StarterPlayerScripts.client.systems;
		expect(clientSystems).toBeDefined();

		expect(clientSystems["combat"]).toBeDefined();
		expect(clientSystems["combat"].$path).toBe("out/systems/combat.client.lua");
	});
});
