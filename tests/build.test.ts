import fs from "fs";
import { build } from "../src/build.js";
import { CliArgs, Environment, Config, Mode, RojoTree } from "../src/types.js";
import { jest } from "@jest/globals";
import path from "path";
import { execute } from "../src/execute.js";
import { defaultConfig } from "../src/constants.js";
import { NullLogger } from "../src/logger.js";

const logger = new NullLogger();

describe("Builder Integration", () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it("should successfully build a tree and ignore non-Roblox files", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "systems",
						isDirectory: () => true,
						isFile: () => false,
					},
					{
						name: "ui",
						isDirectory: () => true,
						isFile: () => false,
					},
					{
						name: "LICENSE",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "Weapon.rbxm",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("systems")) {
				return [
					{
						name: "Combat.server.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("ui")) {
				return [
					{
						name: "init.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "Button.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(3);

		expect(result.name).toBe("test-game");
		expect(result.buildDir).toBe("out");
		expect(result.output).toBe(
			path.resolve(process.cwd(), "test.project.json")
		);

		expect(
			resultTree.ServerScriptService.server.systems.Combat
		).toBeDefined();
		expect(resultTree.ServerScriptService.server.systems.Combat.$path).toBe(
			"out/systems/Combat.server.lua"
		);

		expect(resultTree.ReplicatedStorage.shared.Weapon).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.Weapon.$path).toBe(
			"out/Weapon.rbxm"
		);

		expect(resultTree.ReplicatedStorage.shared.ui).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.ui.$path).toBe("out/ui");
	});

	it("should successfully merge files from multiple source directories into single containers", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src/core")) {
				return [
					{
						name: "CoreMath.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("src/chapter1")) {
				return [
					{
						name: "LevelData.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: ["src/core", "src/chapter1"],
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src/core", "src/chapter1"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2);

		expect(resultTree.ReplicatedStorage.shared.CoreMath).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.LevelData).toBeDefined();

		expect(resultTree.ReplicatedStorage.shared.CoreMath.$path).toBe(
			"out/core/CoreMath.lua"
		);
		expect(resultTree.ReplicatedStorage.shared.LevelData.$path).toBe(
			"out/chapter1/LevelData.lua"
		);
	});

	it("should correctly calculate build paths for deeply nested multiple sources", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src/places/hub")) {
				return [
					{
						name: "HubMain.server.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("src/places/minigame")) {
				return [
					{
						name: "MinigameMain.server.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: ["src/places/hub", "src/places/minigame"],
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src/places/hub", "src/places/minigame"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2);

		expect(resultTree.ServerScriptService.server.HubMain).toBeDefined();
		expect(resultTree.ServerScriptService.server.HubMain.$path).toBe(
			"out/places/hub/HubMain.server.lua"
		);

		expect(
			resultTree.ServerScriptService.server.MinigameMain
		).toBeDefined();
		expect(resultTree.ServerScriptService.server.MinigameMain.$path).toBe(
			"out/places/minigame/MinigameMain.server.lua"
		);
	});

	it("should successfully merge identical virtual folder structures across multiple sources", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src/core")) {
				return [
					{
						name: "ui",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}
			if (normalizedDir.endsWith("src/core/ui")) {
				return [
					{
						name: "Button.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("src/plugins")) {
				return [
					{
						name: "ui",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}
			if (normalizedDir.endsWith("src/plugins/ui")) {
				return [
					{
						name: "Card.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: ["src/core", "src/plugins"],
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src/core", "src/plugins"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2);

		expect(resultTree.ReplicatedStorage.shared.ui).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.ui.Button).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.ui.Card).toBeDefined();

		expect(resultTree.ReplicatedStorage.shared.ui.Button.$path).toBe(
			"out/core/ui/Button.lua"
		);
		expect(resultTree.ReplicatedStorage.shared.ui.Card.$path).toBe(
			"out/plugins/ui/Card.lua"
		);
	});

	it("should apply environment flag filtering correctly across multiple source directories", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src/shared")) {
				return [
					{
						name: "MathUtils.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("src/hub")) {
				return [
					{
						name: "HubManager.prod.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "HubManager.dev.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "src",
			output: "test.project.json",
			tags: { dev: true },
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: ["src/shared", "src/hub"],
			tags: { dev: false, prod: false },
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src/shared", "src/hub"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2);

		expect(resultTree.ReplicatedStorage.shared.MathUtils).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.MathUtils.$path).toBe(
			"src/shared/MathUtils.lua"
		);

		expect(resultTree.ReplicatedStorage.shared.HubManager).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.HubManager.$path).toBe(
			"src/hub/HubManager.dev.lua"
		);

		expect(
			resultTree.ReplicatedStorage.shared["HubManager.prod"]
		).toBeUndefined();
	});

	it("should compile TypeScript sources to .luau paths when the environment is a TS project", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "Weapon.ts",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = { isTsProject: true, isDarkluaProject: false };
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(resultTree.ReplicatedStorage.shared.Weapon.$path).toBe(
			"out/Weapon.luau"
		);
	});

	it("should route files based on marker files instead of folder names", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "Database",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("Database")) {
				return [
					{
						name: ".server",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "query.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(1);

		expect(
			resultTree.ServerScriptService.server.Database.query
		).toBeDefined();
		expect(resultTree.ServerScriptService.server.Database.query.$path).toBe(
			"out/Database/query.lua"
		);
	});

	it("should generate PascalCase tree names without changing source paths", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "features",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("features")) {
				return [
					{
						name: "test",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("test")) {
				return [
					{
						name: "testServiceUtils.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: "src",
			casing: "PascalCase",
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			{},
			process.cwd()
		);
		const node = (result.tree.tree as any).ReplicatedStorage.Shared.features
			.test.testServiceUtils;

		expect(node).toBeDefined();
		expect(node.$path).toBe("out/features/test/testServiceUtils.luau");
	});

	it("should generate camelCase tree names by default without changing source paths", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "Features",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("Features")) {
				return [
					{
						name: "Test",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("Test")) {
				return [
					{
						name: "TestServiceUtils.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			{},
			process.cwd()
		);
		const node = (result.tree.tree as any).ReplicatedStorage.shared.Features
			.Test.TestServiceUtils;

		expect(node).toBeDefined();
		expect(node.$path).toBe("out/Features/Test/TestServiceUtils.luau");
	});

	it("should resolve CLI output relative to cwd, but config output relative to anchor", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(false);

		const targetConfig = {
			build: "out",
			output: "from-config.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree = { name: "test", tree: {} };
		const config = { ...defaultConfig, source: "src" };
		const env = { isTsProject: false, isDarkluaProject: false };
		const anchor = "/mock/custom/anchor/path";

		const resultA = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			{},
			anchor
		);

		const expectedConfigPath = path
			.resolve(anchor, "from-config.json")
			.replace(/\\/g, "/");
		expect(resultA.output.replace(/\\/g, "/")).toBe(expectedConfigPath);

		const cliArgs = { output: "from-cli.json" };
		const resultB = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			anchor
		);

		const expectedCliPath = path
			.resolve(process.cwd(), "from-cli.json")
			.replace(/\\/g, "/");
		expect(resultB.output.replace(/\\/g, "/")).toBe(expectedCliPath);
	});

	it("should create a directory for missing extensionless paths instead of dropping them", async () => {
		jest.spyOn(fs, "existsSync").mockImplementation((p) => {
			const pathStr = String(p).replace(/\\/g, "/");

			if (pathStr.endsWith("test.json")) return false;

			if (pathStr.includes("out/MissingInitFolder")) return false;

			return true;
		});

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");
			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "MissingInitFolder",
						isDirectory: () => true,
						isFile: () => false,
					},
				];
			}
			if (normalizedDir.endsWith("MissingInitFolder")) {
				return [
					{
						name: "init.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				];
			}
			return [];
		});

		const mkdirSpy = jest
			.spyOn(fs, "mkdirSync")
			.mockImplementation(() => undefined as any);
		const writeSpy = jest
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined as any);

		const dummyEnv = { isTsProject: false, isDarkluaProject: false };
		const dummyConfig: Config = {
			...defaultConfig,
			source: "src",
			luau: {
				output: "test.json",
				build: "out",
				tags: {},
				globIgnorePaths: [],
			},
		};
		const baseTree = { name: "test", tree: {} };
		const anchor = process.cwd();

		await execute(
			["src"],
			dummyEnv,
			[{ name: "luau", config: dummyConfig.luau }],
			baseTree,
			dummyConfig,
			{},
			anchor,
			logger
		);

		const expectedDirPath = path.resolve(anchor, "out/MissingInitFolder");

		expect(mkdirSpy).toHaveBeenCalledWith(expectedDirPath, {
			recursive: true,
		});
		expect(writeSpy).not.toHaveBeenCalledWith(expectedDirPath, "");
	});

	it("should support Argon and Rojo data file types (JSON, TOML, YAML, CSV, etc.)", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "config.toml",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "data.json",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "locales.csv",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "notes.txt",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "README.md",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(5);

		expect(resultTree.ReplicatedStorage.shared.config.$path).toBe(
			"out/config.toml"
		);
		expect(resultTree.ReplicatedStorage.shared.data.$path).toBe(
			"out/data.json"
		);
		expect(resultTree.ReplicatedStorage.shared.locales.$path).toBe(
			"out/locales.csv"
		);
		expect(resultTree.ReplicatedStorage.shared.notes.$path).toBe(
			"out/notes.txt"
		);
		expect(resultTree.ReplicatedStorage.shared.README.$path).toBe(
			"out/README.md"
		);
	});

	it("should completely halt routing logic when encountering a .structure marker file", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "vendor",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("vendor")) {
				return [
					{
						name: ".structure",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "main.server.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "Client",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("Client")) {
				return [
					{
						name: "apiClient.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2);

		const vendorFolder = resultTree.ReplicatedStorage.shared.vendor;
		expect(vendorFolder).toBeDefined();

		expect(vendorFolder["main.server"]).toBeDefined();
		expect(vendorFolder["main.server"].$path).toBe(
			"out/vendor/main.server.lua"
		);

		expect(vendorFolder.Client["apiClient"]).toBeDefined();
		expect(vendorFolder.Client["apiClient"].$path).toBe(
			"out/vendor/Client/apiClient.lua"
		);

		expect(resultTree.ServerScriptService).toBeUndefined();
		expect(resultTree.StarterPlayerScripts).toBeUndefined();
	});

	it("should preserve routing keywords in file names when encountering a .verbatim marker", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "systems",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("systems")) {
				return [
					{
						name: ".verbatim",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "combatServer.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "combat.client.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };

		const config: Config = {
			...defaultConfig,
			source: "src",
			verbatim: false,
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		const serverSystems = resultTree.ServerScriptService.server.systems;
		expect(serverSystems).toBeDefined();

		expect(serverSystems["combatServer"]).toBeDefined();
		expect(serverSystems["combatServer"].$path).toBe(
			"out/systems/combatServer.lua"
		);

		const clientSystems =
			resultTree.StarterPlayer.StarterPlayerScripts.client.systems;
		expect(clientSystems).toBeDefined();

		expect(clientSystems["combat"]).toBeDefined();
		expect(clientSystems["combat"].$path).toBe(
			"out/systems/combat.client.lua"
		);
	});

	it("should detect and report same-source collisions", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "api.server.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "api_server.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);

		expect(result.collisions.length).toBe(1);
		expect(result.collisions[0]).toContain("Name collision");
		expect(result.collisions[0]).toContain("api.server.luau");
		expect(result.collisions[0]).toContain("api_server.luau");
	});

	it("should not report collisions for intentional cross-source overrides", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src/core")) {
				return [
					{
						name: "api.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			if (normalizedDir.endsWith("src/hub")) {
				return [
					{
						name: "api.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: ["src/core", "src/hub"],
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src/core", "src/hub"],
			cliArgs,
			process.cwd()
		);

		expect(result.collisions.length).toBe(0);
	});

	it("should drop files matching the global globIgnorePaths glob pattern", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "main.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "main.spec.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "utils",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("utils")) {
				return [
					{
						name: "math.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "math.spec.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: "src",
			globIgnorePaths: ["**/*.spec.luau"],
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2);

		expect(resultTree.ReplicatedStorage.shared.main).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.utils.math).toBeDefined();

		expect(
			resultTree.ReplicatedStorage.shared["main.spec"]
		).toBeUndefined();
		expect(
			resultTree.ReplicatedStorage.shared.utils["math.spec"]
		).toBeUndefined();
	});

	it("should combine global and mode-specific globIgnorePaths patterns", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "main.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "main.spec.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "main.story.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: ["**/*.story.luau"],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };

		const config: Config = {
			...defaultConfig,
			source: "src",
			globIgnorePaths: ["**/*.spec.luau"],
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			{},
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(1);

		expect(resultTree.ReplicatedStorage.shared.main).toBeDefined();
		expect(
			resultTree.ReplicatedStorage.shared["main.spec"]
		).toBeUndefined();
		expect(
			resultTree.ReplicatedStorage.shared["main.story"]
		).toBeUndefined();
	});

	it("should correctly merge tags hierarchically (Root -> Mode -> CLI)", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "Api.dev.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "Database.prod.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "Logger.experimental.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: { dev: false, prod: true },
			globIgnorePaths: [],
		};

		const baseTree: RojoTree = { name: "test-game", tree: {} };

		const config: Config = {
			...defaultConfig,
			source: "src",
			tags: { dev: true, prod: false, experimental: false },
		};

		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const cliArgs: CliArgs = { tag: ["experimental"] };

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);

		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(2);

		expect(resultTree.ReplicatedStorage.shared.Database).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.Database.$path).toBe(
			"out/Database.prod.lua"
		);

		expect(resultTree.ReplicatedStorage.shared.Logger).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.Logger.$path).toBe(
			"out/Logger.experimental.lua"
		);
	});

	it("should detect and return exposed data files in the BuildResult", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "config.json",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "main.luau",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			{},
			process.cwd()
		);

		expect(result.exposedDataFiles).toBeDefined();
		expect(result.exposedDataFiles).toHaveLength(1);
		expect(result.exposedDataFiles[0]).toBe("out/config.json");
	});

	it("should skip writing the project file and log a warning if data files are exposed", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "data.toml",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const writeSpy = jest
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined as any);

		const warnSpy = jest.spyOn(logger, "warn");

		const dummyEnv = { isTsProject: false, isDarkluaProject: false };
		const dummyConfig: Config = {
			...defaultConfig,
			source: "src",
			luau: {
				output: "test.json",
				build: "out",
				tags: {},
				globIgnorePaths: [],
			},
		};
		const baseTree = { name: "test", tree: {} };

		await execute(
			["src"],
			dummyEnv,
			[{ name: "luau", config: dummyConfig.luau }],
			baseTree,
			dummyConfig,
			{},
			process.cwd(),
			logger
		);

		expect(writeSpy).not.toHaveBeenCalled();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Skipping project file generation")
		);
	});

	it("should treat a .sync folder as a black box, halting traversal and mapping the folder natively", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "Packages",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("Packages")) {
				return [
					{
						name: ".sync",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "leak.dev.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = { ...defaultConfig, source: "src" };
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};
		const cliArgs: CliArgs = {};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(result.fileCount).toBe(1);

		const packagesFolder = resultTree.ReplicatedStorage.shared.Packages;
		expect(packagesFolder).toBeDefined();
		expect(packagesFolder.$path).toBe("out/Packages");

		expect(packagesFolder["leak"]).toBeUndefined();
	});
});

describe("unwrap Routing Overrides", () => {
	it("should skip wrapper folders globally when unwrap is true", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "combat.server.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "ui.client.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: "src",
			unwrap: true,
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			{},
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(resultTree.ServerScriptService.server).toBeUndefined();
		expect(resultTree.ServerScriptService.combat).toBeDefined();
		expect(resultTree.ServerScriptService.combat.$path).toBe(
			"out/combat.server.lua"
		);

		expect(
			resultTree.StarterPlayer.StarterPlayerScripts.client
		).toBeUndefined();
		expect(resultTree.StarterPlayer.StarterPlayerScripts.ui).toBeDefined();
	});

	it("should skip wrapper folders only for directories containing a .unwrap marker", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "FlatFeature",
						isDirectory: () => true,
						isFile: () => false,
					},
					{
						name: "NormalFeature",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("FlatFeature")) {
				return [
					{
						name: ".unwrap",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "api.server.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("NormalFeature")) {
				return [
					{
						name: "data.server.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: "src",
			unwrap: false,
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			{},
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(resultTree.ServerScriptService.FlatFeature).toBeDefined();
		expect(resultTree.ServerScriptService.FlatFeature.api).toBeDefined();

		expect(
			resultTree.ServerScriptService.server.NormalFeature
		).toBeDefined();
		expect(
			resultTree.ServerScriptService.server.NormalFeature.data
		).toBeDefined();
	});

	it("should cascade the .unwrap marker to nested subdirectories", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "ParentSystem",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("ParentSystem")) {
				return [
					{
						name: ".unwrap",
						isDirectory: () => false,
						isFile: () => true,
					},
					{
						name: "NestedSubsystem",
						isDirectory: () => true,
						isFile: () => false,
					},
				] as fs.Dirent[];
			}

			if (normalizedDir.endsWith("NestedSubsystem")) {
				return [
					{
						name: "deep.server.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: {},
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: "src",
			unwrap: false,
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			{},
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(resultTree.ServerScriptService.server).toBeUndefined();
		expect(
			resultTree.ServerScriptService.ParentSystem.NestedSubsystem.deep
		).toBeDefined();
		expect(
			resultTree.ServerScriptService.ParentSystem.NestedSubsystem.deep
				.$path
		).toBe("out/ParentSystem/NestedSubsystem/deep.server.lua");
	});

	it("should merge CLI flags and rescue files that would otherwise drop", async () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);

		(
			jest.spyOn(fs.promises, "readdir") as jest.Mock<
				(dir: string) => Promise<any[]>
			>
		).mockImplementation(async (dir: string) => {
			const normalizedDir = String(dir).replace(/\\/g, "/");

			if (normalizedDir.endsWith("src")) {
				return [
					{
						name: "api.experimental.lua",
						isDirectory: () => false,
						isFile: () => true,
					},
				] as fs.Dirent[];
			}
			return [];
		});

		const targetConfig: Mode = {
			build: "out",
			output: "test.project.json",
			tags: { prod: true },
			globIgnorePaths: [],
		};
		const baseTree: RojoTree = { name: "test-game", tree: {} };
		const config: Config = {
			...defaultConfig,
			source: "src",
			tags: { prod: false, experimental: false },
		};
		const env: Environment = {
			isTsProject: false,
			isDarkluaProject: false,
		};

		const cliArgs: CliArgs = { tag: ["experimental"] };

		const result = await build(
			targetConfig,
			baseTree,
			config,
			env,
			["src"],
			cliArgs,
			process.cwd()
		);
		const resultTree = result.tree.tree as any;

		expect(resultTree.ReplicatedStorage.shared.api).toBeDefined();
		expect(resultTree.ReplicatedStorage.shared.api.$path).toBe(
			"out/api.experimental.lua"
		);
	});
});
