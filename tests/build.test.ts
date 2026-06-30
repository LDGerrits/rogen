import fs from "fs";
import { build } from "../src/core/build.js";
import { CliArgs, Environment, RogenConfig, RogenMode, RojoTree } from "../src/types.js";
import { jest } from "@jest/globals";

describe("Builder Integration", () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it("should successfully build a tree and ignore non-Roblox files", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs, "readdirSync") as jest.Mock<(dir: string) => any[]>).mockImplementation((dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");
			
			if (normalizedDir.endsWith("src")) {
				return [
					{ name: "systems", isDirectory: () => true, isFile: () => false },
					{ name: "ui", isDirectory: () => true, isFile: () => false },
					{ name: "ignoreMe.txt", isDirectory: () => false, isFile: () => true },
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

		const result = build(targetConfig, baseTree, config, env, ["src"], cliArgs);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(3); 
		
		expect(result.name).toBe("test-game");
		expect(result.buildDir).toBe("out");
		expect(result.output).toBe("test.project.json");

		expect(resultTree.ServerScriptService.server.systems.Combat).toBeDefined();
		expect(resultTree.ServerScriptService.server.systems.Combat.$path).toBe("out/systems/Combat.server.lua");

		expect(resultTree.ReplicatedStorage.shared.Weapon).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.Weapon.$path).toBe("out/Weapon.rbxm");

		expect(resultTree.ReplicatedStorage.shared.ui).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.ui.$path).toBe("out/ui");
	});

	it("should successfully merge files from multiple source directories into single containers", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs, "readdirSync") as jest.Mock<(dir: string) => any[]>).mockImplementation((dir: string) => {
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

		const result = build(targetConfig, baseTree, config, env, ["src/core", "src/chapter1"], cliArgs);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2); 

		expect(resultTree.ReplicatedStorage.shared.CoreMath).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.LevelData).toBeDefined();
		
		expect(resultTree.ReplicatedStorage.shared.CoreMath.$path).toBe("out/core/CoreMath.lua");
		expect(resultTree.ReplicatedStorage.shared.LevelData.$path).toBe("out/chapter1/LevelData.lua");
	});

	it("should route files based on marker files instead of folder names", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(jest.spyOn(fs, "readdirSync") as jest.Mock<(dir: string) => any[]>).mockImplementation((dir: string) => {
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

		const result = build(targetConfig, baseTree, config, env, ["src"], cliArgs);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(1); 
		
		expect(resultTree.ServerScriptService.server.Database.query).toBeDefined();
		expect(resultTree.ServerScriptService.server.Database.query.$path).toBe("out/Database/query.lua");
	});
});