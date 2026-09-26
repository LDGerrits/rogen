import { jest } from "@jest/globals";
import path from "path";
import "../../../domain/config/config.js";
import "../init-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { readConfigFile } from "../../../platform/config/config-file.js";
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
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";

const STARTING_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

describe("init command", () => {
	const cwd = path.resolve("/mock/my-game");
	let memFs: MemoryFileSystemService;
	let store: DisposableStore;

	const runInit = (
		names: string[] = [],
		promptService: PromptService = new MockPromptService([], false),
		logService: LogService = new NullLogService()
	) => {
		const environment = new NativeEnvironmentService(
			{ _: ["init", ...names] },
			cwd
		);
		const services = new ServiceCollection();
		services.set(EnvironmentService, environment);
		services.set(FileSystemService, memFs);
		services.set(LogService, logService);
		services.set(PromptService, promptService);

		return store
			.add(new CoreCommandService(services, logService))
			.executeCommand("init", environment.args);
	};

	const write = (file: string, content = "") =>
		memFs.writeFile(path.join(cwd, file), content);
	const read = (file: string) => memFs.readFile(path.join(cwd, file));
	const readJson = async (file: string) => JSON.parse(await read(file));
	const exists = (file: string) => memFs.exists(path.join(cwd, file));
	const errorMessage = (result: Awaited<ReturnType<typeof runInit>>) =>
		(result as ResultError<Error>).error.message;
	const diagnosticsOf = (result: Awaited<ReturnType<typeof runInit>>) =>
		((result as ResultError<Error>).error as DiagnosticsError).diagnostics;

	beforeEach(async () => {
		memFs = new MemoryFileSystemService();
		store = new DisposableStore();
		await memFs.createDirectory(cwd);
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("output", () => {
		it("should open with a header, list each file written and close with a result", async () => {
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"success: Created default.rogen.json.",
				"outro: Wrote 1 file.",
			]);
		});

		it("should print nothing after the header when the config already exists", async () => {
			await write("default.rogen.json", "{}");
			const logService = new MockLogService();

			const result = await runInit(
				[],
				new MockPromptService([], false),
				logService
			);

			expect(result.isErr()).toBe(true);
			expect(logService.lines).toEqual(["intro: rogen init"]);
		});
	});

	describe("toolchains", () => {
		it("should write a plain config when no toolchain is found", async () => {
			const result = await runInit();

			expect(result.isOk()).toBe(true);
			const config = await readJson("default.rogen.json");
			expect(config.rootDirs).toEqual(["src"]);
			expect(config.routes).toEqual(STARTING_ROUTES);
			expect(config.syncDir).toBeUndefined();
			expect(config.template).toBeUndefined();
			expect(await exists("template.project.json")).toBe(false);
		});

		it("should use the tsconfig outDir as syncDir for roblox-ts", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ compilerOptions: { outDir: "build" } })
			);

			await runInit();

			expect((await readJson("default.rogen.json")).syncDir).toBe(
				"build"
			);
		});

		it("should fall back to out when tsconfig has no outDir", async () => {
			await write("tsconfig.json", "{}");

			await runInit();

			expect((await readJson("default.rogen.json")).syncDir).toBe("out");
		});

		it("should write one config for roblox-ts", async () => {
			await write("tsconfig.json", "{}");

			await runInit();

			expect(await exists("source.rogen.json")).toBe(false);
		});

		it("should write a source config and a synced default config for darklua", async () => {
			await write(".darklua.json");

			await runInit();

			const source = await readJson("source.rogen.json");
			const config = await readJson("default.rogen.json");
			expect(source.syncDir).toBeUndefined();
			expect(source.routes).toEqual(STARTING_ROUTES);
			expect(config.extends).toBe("source.rogen.json");
			expect(config.syncDir).toBe("dist");
			expect(config.routes).toBeUndefined();
		});

		it("should write <name> and <name>-source for a named darklua config", async () => {
			await write(".darklua.json5");

			await runInit(["lobby"]);

			expect((await readJson("lobby.rogen.json")).extends).toBe(
				"lobby-source.rogen.json"
			);
			expect(await exists("lobby-source.rogen.json")).toBe(true);
			expect(await exists("default.rogen.json")).toBe(false);
			expect(await exists("source.rogen.json")).toBe(false);
		});
	});

	describe("package mounts", () => {
		it.each([
			["wally.toml", "Packages", "Packages"],
			["pesde.toml", "roblox_packages", "roblox_packages"],
			[
				"node_modules/@rbxts/types/package.json",
				"",
				"node_modules/@rbxts",
			],
		])(
			"should write a template with mounts when %s is found",
			async (file, dir, mounted) => {
				await write(file);
				if (dir) await memFs.createDirectory(path.join(cwd, dir));

				await runInit();

				expect((await readJson("default.rogen.json")).template).toBe(
					"template.project.json"
				);
				const template = await readJson("template.project.json");
				expect(template.name).toBe("my-game");
				expect(template.tree.$className).toBe("DataModel");
				expect(JSON.stringify(template.tree)).toContain(mounted);
			}
		);

		it("should not write a template without mounts", async () => {
			await write("tsconfig.json", "{}");

			await runInit();

			expect(await exists("template.project.json")).toBe(false);
			expect(
				(await readJson("default.rogen.json")).template
			).toBeUndefined();
		});

		it("should reference an existing template and leave it untouched", async () => {
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));
			await write("template.project.json", '{"name":"mine"}');

			await runInit(["lobby"]);

			expect(await read("template.project.json")).toBe('{"name":"mine"}');
			expect((await readJson("lobby.rogen.json")).template).toBe(
				"template.project.json"
			);
		});

		it("should share one template between two configs", async () => {
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();
			const template = await read("template.project.json");
			await runInit(["lobby"]);

			expect(await read("template.project.json")).toBe(template);
			expect((await readJson("lobby.rogen.json")).template).toBe(
				"template.project.json"
			);
		});

		it("should put the template in the darklua source config only", async () => {
			await write(".darklua.json");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			expect((await readJson("source.rogen.json")).template).toBe(
				"template.project.json"
			);
			expect(
				(await readJson("default.rogen.json")).template
			).toBeUndefined();
		});
	});

	describe("written files", () => {
		it("should write strict JSON that parses under the config schema", async () => {
			await write(".darklua.json");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			for (const file of ["default.rogen.json", "source.rogen.json"]) {
				const text = await read(file);
				expect(() => JSON.parse(text)).not.toThrow();
				expect(
					(await readConfigFile(memFs, path.join(cwd, file))).isOk()
				).toBe(true);
			}
		});

		it("should write fields in pipeline order", async () => {
			await write("tsconfig.json", "{}");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			expect(Object.keys(await readJson("default.rogen.json"))).toEqual([
				"$schema",
				"rootDirs",
				"routes",
				"template",
				"syncDir",
			]);
		});

		it("should never write into .vscode", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			await runInit();

			expect(await exists(".vscode")).toBe(false);
		});
	});

	describe("names", () => {
		it("should write default.rogen.json for a bare init", async () => {
			await runInit();

			expect(await exists("default.rogen.json")).toBe(true);
		});

		it("should write <name>.rogen.json for a named init", async () => {
			await runInit(["lobby"]);

			expect(await exists("lobby.rogen.json")).toBe(true);
			expect(await exists("default.rogen.json")).toBe(false);
		});

		it.each(["a/b", "..\\x", "..", "."])(
			"should reject the name %s",
			async (name) => {
				const result = await runInit([name]);

				expect(result.isErr()).toBe(true);
				expect(errorMessage(result)).toContain(
					"not a valid config name"
				);
			}
		);

		it("should reject more than one name", async () => {
			const result = await runInit(["a", "b"]);

			expect(result.isErr()).toBe(true);
			expect(await exists("a.rogen.json")).toBe(false);
		});
	});

	describe("interactive", () => {
		it("should write what plain init writes when every default is accepted", async () => {
			await write("tsconfig.json", "{}");
			await write("Packages/x.luau");
			await write("wally.toml");
			const prompts = new MockPromptService(
				Array(5).fill(ACCEPT_DEFAULT)
			);

			const result = await runInit([], prompts);
			const interactive = await readJson("default.rogen.json");
			const interactiveTemplate = await readJson("template.project.json");
			await memFs.delete(path.join(cwd, "default.rogen.json"));
			await memFs.delete(path.join(cwd, "template.project.json"));
			await runInit();

			expect(result.isOk()).toBe(true);
			expect(interactive).toEqual(await readJson("default.rogen.json"));
			expect(interactiveTemplate).toEqual(
				await readJson("template.project.json")
			);
		});

		it("should write the answers", async () => {
			const prompts = new MockPromptService([
				"game",
				"darklua",
				"src, lib",
				"out",
				[],
			]);

			await runInit([], prompts);

			const source = await readJson("game-source.rogen.json");
			expect(source.rootDirs).toEqual(["src", "lib"]);
			expect((await readJson("game.rogen.json")).syncDir).toBe("out");
		});

		it("should mount a folder that is not installed as optional", async () => {
			const prompts = new MockPromptService([
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				["Packages"],
			]);

			await runInit([], prompts);

			expect(
				(await readJson("template.project.json")).tree.ReplicatedStorage
			).toEqual({ Packages: { $path: { optional: "Packages" } } });
		});

		it("should not ask for a name that was given", async () => {
			const prompts = new MockPromptService(
				Array(4).fill(ACCEPT_DEFAULT)
			);

			await runInit(["lobby"], prompts);

			expect(prompts.asked).not.toContain("Config name");
			expect(await exists("lobby.rogen.json")).toBe(true);
		});

		it("should write nothing when cancelled", async () => {
			const result = await runInit([], new MockPromptService([CANCEL]));

			expect(result.isErr()).toBe(true);
			expect(await exists("default.rogen.json")).toBe(false);
		});

		it("should not ask when there is no terminal", async () => {
			const prompts = new MockPromptService([], false);

			const result = await runInit([], prompts);

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([]);
		});
	});

	describe("existing files", () => {
		it("should fail when default.rogen.json exists, and leave it alone", async () => {
			await write("default.rogen.json", "{}");

			const result = await runInit();

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "default.rogen.json"),
				},
			]);
			expect(await read("default.rogen.json")).toBe("{}");
		});

		it("should fail when the named config exists", async () => {
			await write("lobby.rogen.json", "{}");

			const result = await runInit(["lobby"]);

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "lobby.rogen.json"),
				},
			]);
		});

		it("should allow a named init beside an existing default config", async () => {
			await write("default.rogen.json", "{}");

			const result = await runInit(["lobby"]);

			expect(result.isOk()).toBe(true);
			expect(await read("default.rogen.json")).toBe("{}");
			expect(await exists("lobby.rogen.json")).toBe(true);
		});

		it("should write nothing when one darklua file already exists", async () => {
			await write(".darklua.json");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));
			await write("source.rogen.json", "{}");

			const result = await runInit();

			expect(result.isErr()).toBe(true);
			expect(await exists("default.rogen.json")).toBe(false);
			expect(await exists("template.project.json")).toBe(false);
		});

		it("should ignore an existing default.project.json", async () => {
			await write("default.project.json", '{"name":"hand-written"}');

			const result = await runInit();

			expect(result.isOk()).toBe(true);
			expect(await read("default.project.json")).toBe(
				'{"name":"hand-written"}'
			);
			expect(
				(await readJson("default.rogen.json")).template
			).toBeUndefined();
		});
	});

	it("should return a structured error if writing a file fails", async () => {
		jest.spyOn(memFs, "writeFile").mockRejectedValue(
			new Error("Permission denied")
		);

		const result = await runInit();

		expect(result.isErr()).toBe(true);
		expect(errorMessage(result)).toContain(
			"Failed to write default.rogen.json"
		);
		expect(errorMessage(result)).toContain("Permission denied");
	});
});
