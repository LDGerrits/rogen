import { jest } from "@jest/globals";
import "../../../domain/config/config.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResultError } from "../../../base/result.js";
import { InitCommand } from "../init-command.js";
import path from "path";
import { WorkspaceService } from "../../../domain/workspace/workspace-service.js";
import { NullLogService } from "../../../platform/log/log-service.js";
import { NativeEnvironmentService } from "../../../platform/environment/environment-service.js";

describe("InitCommand", () => {
	let memFs: MemoryFileSystemService;
	let logService: NullLogService;

	const createEnvironment = (cwd: string) =>
		new NativeEnvironmentService({ _: [] }, cwd);

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
		logService = new NullLogService();
	});

	it("should return an error if .rogen.json already exists", async () => {
		const cwd = path.resolve("/mock/cwd");
		const targetPath = path.resolve(cwd, ".rogen.json");
		await memFs.writeFile(targetPath, "{}");

		const environment = createEnvironment(cwd);
		const workspaceService = new WorkspaceService(environment, memFs);

		const command = new InitCommand(
			environment,
			memFs,
			workspaceService,
			logService
		);
		const result = await command.execute();

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"already exists in this directory"
		);
	});

	it("should generate a clean Luau config when no toolchains are detected", async () => {
		const cwd = path.resolve("/mock/my-game");
		await memFs.createDirectory(cwd);

		const environment = createEnvironment(cwd);
		const workspaceService = new WorkspaceService(environment, memFs);

		const command = new InitCommand(
			environment,
			memFs,
			workspaceService,
			logService
		);
		const result = await command.execute();

		expect(result.isOk()).toBe(true);

		const targetPath = path.resolve(cwd, ".rogen.json");
		const writtenContent = await memFs.readFile(targetPath);
		const config = JSON.parse(writtenContent);

		expect(config.luau).toBeDefined();
		expect(config.ts).toBeUndefined();
		expect(config.darklua).toBeUndefined();
		expect(config.template.name).toBe("my-game");
		expect(config.template.tree).toEqual({ $className: "DataModel" });
		expect(config.template.globIgnorePaths).toEqual([]);
	});

	it("should tailor the config for TypeScript and Wally, injecting correct workspace packages", async () => {
		const cwd = path.resolve("/mock/ts-game");

		await memFs.writeFile(path.join(cwd, "tsconfig.json"), "{}");
		await memFs.writeFile(path.join(cwd, "wally.toml"), "{}");
		await memFs.writeFile(
			path.join(cwd, "node_modules", "@rbxts", "package.json"),
			"{}"
		);
		await memFs.createDirectory(path.join(cwd, "Packages"));

		const environment = createEnvironment(cwd);
		const workspaceService = new WorkspaceService(environment, memFs);

		const command = new InitCommand(
			environment,
			memFs,
			workspaceService,
			logService
		);
		const result = await command.execute();

		expect(result.isOk()).toBe(true);

		const targetPath = path.resolve(cwd, ".rogen.json");
		const writtenContent = await memFs.readFile(targetPath);
		const config = JSON.parse(writtenContent);

		expect(config.ts).toBeDefined();
		expect(config.luau).toBeUndefined();
		expect(config.template.globIgnorePaths).toContain("**/tsconfig.json");

		const tree = config.template.tree;
		expect(
			tree.ReplicatedStorage.rbxts_include.node_modules["@rbxts"]
		).toBeDefined();
		expect(tree.ReplicatedStorage.Packages).toBeDefined();
	});

	it("should return a structured error if writing the config file to disk fails", async () => {
		const cwd = path.resolve("/mock/cwd");
		await memFs.createDirectory(cwd);

		jest.spyOn(memFs, "writeFile").mockRejectedValue(
			new Error("Permission denied")
		);

		const environment = createEnvironment(cwd);
		const workspaceService = new WorkspaceService(environment, memFs);

		const command = new InitCommand(
			environment,
			memFs,
			workspaceService,
			logService
		);
		const result = await command.execute();

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Failed to write .rogen.json"
		);
		expect((result as ResultError<Error>).error.message).toContain(
			"Permission denied"
		);
	});
});
