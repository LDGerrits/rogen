import { jest } from "@jest/globals";
import path from "path";
import "../../../domain/config/config.js";
import "../init-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { ResultError } from "../../../base/result.js";
import { CoreWorkspaceService } from "../../../domain/workspace/core-workspace-service.js";
import { WorkspaceService } from "../../../domain/workspace/workspace-service.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import {
	EnvironmentService,
	NativeEnvironmentService,
} from "../../../platform/environment/environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";

describe("init command", () => {
	let memFs: MemoryFileSystemService;
	let logService: NullLogService;
	let store: DisposableStore;

	const runInit = (cwd: string) => {
		const environment = new NativeEnvironmentService({ _: ["init"] }, cwd);
		const services = new ServiceCollection();
		services.set(EnvironmentService, environment);
		services.set(FileSystemService, memFs);
		services.set(
			WorkspaceService,
			new CoreWorkspaceService(environment, memFs)
		);
		services.set(LogService, logService);

		return store
			.add(new CoreCommandService(services, logService))
			.executeCommand("init", environment.args);
	};

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
		logService = new NullLogService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should return an error if default.rogen.json already exists", async () => {
		const cwd = path.resolve("/mock/cwd");
		const targetPath = path.resolve(cwd, "default.rogen.json");
		await memFs.writeFile(targetPath, "{}");

		const result = await runInit(cwd);

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"already exists in this directory"
		);
	});

	it("should generate a clean Luau config when no toolchains are detected", async () => {
		const cwd = path.resolve("/mock/my-game");
		await memFs.createDirectory(cwd);

		const result = await runInit(cwd);

		expect(result.isOk()).toBe(true);

		const targetPath = path.resolve(cwd, "default.rogen.json");
		const writtenContent = await memFs.readFile(targetPath);
		const config = JSON.parse(writtenContent);

		expect(config.rootDirs).toEqual(["src"]);
		expect(config.routes).toEqual({
			server: "ServerScriptService",
			client: "StarterPlayer/StarterPlayerScripts",
			shared: "ReplicatedStorage/shared",
			"*": "ReplicatedStorage/shared",
		});
		expect(config.template).toBeUndefined();
		expect(await memFs.exists(path.resolve(cwd, "base.project.json"))).toBe(
			false
		);
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

		const result = await runInit(cwd);

		expect(result.isOk()).toBe(true);

		const targetPath = path.resolve(cwd, "default.rogen.json");
		const writtenContent = await memFs.readFile(targetPath);
		const config = JSON.parse(writtenContent);

		expect(config.rootDirs).toEqual(["src"]);
		expect(config.template).toBe("base.project.json");

		const templatePath = path.resolve(cwd, "base.project.json");
		const templateContent = await memFs.readFile(templatePath);
		const template = JSON.parse(templateContent);

		expect(template.name).toBe("ts-game");
		const tree = template.tree;
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

		const result = await runInit(cwd);

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Failed to write default.rogen.json"
		);
		expect((result as ResultError<Error>).error.message).toContain(
			"Permission denied"
		);
	});
});
