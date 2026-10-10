import path from "path";
import "../init-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { SCHEMA_URL } from "../../../domain/config/config.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
import {
	CANCEL,
	MockPromptService,
	ScriptedAnswers,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { CommandLine } from "../../../platform/environment/args.js";

const WHAT_TO_ADD = "default.rogen.json exists. What do you want to add?";
const LUAU_ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	Shared: "ReplicatedStorage/Shared",
	"*": "ReplicatedStorage/Shared",
};

describe("init command", () => {
	const cwd = path.resolve("/mock/my-game");
	let memFs: MemoryFileSystemService;

	const runInit = async (
		names: string[] = [],
		prompt: PromptService = new MockPromptService([], false),
		log: MockLogService = new MockLogService(),
		options: CommandLine["options"] = {}
	) => {
		const harness = commandHarness({
			cwd,
			fs: memFs,
			log,
			prompt,
			environment: new NativeEnvironmentService(options, cwd),
		});
		return harness.run("init", { positionals: names, options });
	};

	const write = (file: string, content = "") =>
		memFs.writeFile(path.join(cwd, file), content);
	const read = (file: string) => memFs.readFile(path.join(cwd, file));
	const readJson = async (file: string) => JSON.parse(await read(file));
	const exists = (file: string) => memFs.exists(path.join(cwd, file));
	const diagnosticsOf = (result: Awaited<ReturnType<typeof runInit>>) =>
		((result as ResultError<Error>).error as DiagnosticsError).diagnostics;

	beforeEach(async () => {
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory(cwd);
	});

	describe("places", () => {
		const setUpLuau = async () => {
			await write(
				"default.rogen.json",
				JSON.stringify({ rootDirs: ["src"], routes: LUAU_ROUTES })
			);
			await write("src/A.luau");
		};
		const offerAnd = (answers: ScriptedAnswers = {}) =>
			new MockPromptService({ [WHAT_TO_ADD]: "place", ...answers });

		it("should not offer a place when default.rogen.json does not exist", async () => {
			const prompts = new MockPromptService({});

			await runInit([], prompts);

			expect(prompts.asked).not.toContain(WHAT_TO_ADD);
		});

		it("should write one config extending default, with the place's code in src and its template beside it", async () => {
			await setUpLuau();
			const before = await memFs.readDirectory(cwd);

			const result = await runInit(
				[],
				offerAnd({ "Place name": "lobby" })
			);

			expect(result.isOk()).toBe(true);
			expect(await readJson("lobby.rogen.json")).toEqual({
				$schema: SCHEMA_URL,
				extends: "./default.rogen.json",
				rootDirs: ["places/lobby/src"],
				template: "places/lobby/template.project.json",
			});
			expect(
				await readJson("places/lobby/template.project.json")
			).toEqual({
				name: "Lobby",
				servePort: 34873,
				tree: { $className: "DataModel" },
			});
			const after = await memFs.readDirectory(cwd);
			expect(after.length).toBe(before.length + 3);
		});

		it("should create the place's src so the next build finds it", async () => {
			await setUpLuau();

			await runInit([], offerAnd({ "Place name": "lobby" }));

			expect(await exists("places/lobby/src")).toBe(true);
		});

		it("should give a place the first port above 34872 no other config's template uses", async () => {
			await setUpLuau();
			await write(
				"arena.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					template: "arena.template.json",
				})
			);
			await write(
				"arena.template.json",
				JSON.stringify({
					name: "Arena",
					servePort: 34873,
					tree: { $className: "DataModel" },
				})
			);
			await write(
				"shop.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					template: "shop.template.json",
				})
			);
			await write(
				"shop.template.json",
				JSON.stringify({
					name: "Shop",
					servePort: 34875,
					tree: { $className: "DataModel" },
				})
			);

			await runInit(["lobby"]);

			expect(
				(await readJson("places/lobby/template.project.json")).servePort
			).toBe(34874);
		});

		it("should put the place folder beside the shared folder default's root dir is in", async () => {
			await write(
				"default.rogen.json",
				JSON.stringify({
					rootDirs: ["projects/shared/src"],
					routes: LUAU_ROUTES,
				})
			);

			await runInit(["lobby"]);

			expect(await readJson("lobby.rogen.json")).toMatchObject({
				rootDirs: ["projects/lobby/src"],
				template: "projects/lobby/template.project.json",
			});
		});

		it("should keep a place folder that already holds code as the root dir, with the template beside it", async () => {
			await setUpLuau();
			await write("places/lobby/Main.luau", "");
			const logService = new MockLogService();

			await runInit([], offerAnd({ "Place name": "lobby" }), logService);

			expect(await readJson("lobby.rogen.json")).toMatchObject({
				rootDirs: ["places/lobby"],
				template: "places/lobby.template.project.json",
			});
			expect(
				await readJson("places/lobby.template.project.json")
			).toEqual({
				name: "Lobby",
				servePort: 34873,
				tree: { $className: "DataModel" },
			});
			expect(await exists("places/lobby/src")).toBe(false);
			expect(logService.lines).not.toContain(
				"success: Created places/lobby/."
			);
		});

		it("should root a place folder that already has src in src", async () => {
			await setUpLuau();
			await write("places/lobby/src/Main.luau", "");

			await runInit(["lobby"]);

			expect(await readJson("lobby.rogen.json")).toMatchObject({
				rootDirs: ["places/lobby/src"],
				template: "places/lobby/template.project.json",
			});
		});

		it("should use a place template that is already there, as it is", async () => {
			await setUpLuau();
			await write(
				"places/lobby/template.project.json",
				'{ "name": "Mine" }'
			);
			const logService = new MockLogService();

			await runInit(["lobby"], undefined, logService);

			expect(await read("places/lobby/template.project.json")).toBe(
				'{ "name": "Mine" }'
			);
			expect((await readJson("lobby.rogen.json")).template).toBe(
				"places/lobby/template.project.json"
			);
			expect(logService.lines).toContain(
				"info: Using places/lobby/template.project.json."
			);
		});

		it("should name the place to serve when other configs here share a port", async () => {
			await setUpLuau();
			await write(
				"arena.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			await write(
				"shop.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			const logService = new MockLogService();

			await runInit(["lobby"], undefined, logService);

			expect(logService.lines).toContain("info:   rogen serve lobby");
		});

		it("should serve every place, now that each has its own port", async () => {
			await setUpLuau();
			const logService = new MockLogService();

			await runInit(["lobby"], undefined, logService);

			expect(logService.lines).toContain("info:   rogen serve");
		});

		it("should build a place that serves on its own port and under its own name", async () => {
			await setUpLuau();

			await runInit(["lobby"]);

			const entry = await new CoreConfigService(
				memFs,
				new NativeEnvironmentService({}, cwd)
			).read(path.join(cwd, "lobby.rogen.json"));
			expect(entry.status).toBe("valid");
			if (entry.status !== "valid") return;
			expect(entry.config.projectName).toBe("Lobby");
			expect(entry.config.template?.project.servePort).toBe(34873);
		});

		it("should ask the place name and folder, and nothing else", async () => {
			await setUpLuau();
			const prompts = offerAnd({
				"Place name": "lobby",
				"Place folder": "world/lobby",
			});

			await runInit([], prompts);

			expect(prompts.asked).toEqual([
				WHAT_TO_ADD,
				"Place name",
				"Place folder",
			]);
			expect(prompts.prompts[2]).toMatchObject({
				placeholder: "places/lobby",
			});
			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"world/lobby/src",
			]);
		});

		it("should not ask for a place name that was given", async () => {
			await setUpLuau();
			const prompts = offerAnd();

			await runInit(["lobby"], prompts);

			expect(prompts.asked).not.toContain("Place name");
			expect(await exists("lobby.rogen.json")).toBe(true);
		});

		it("should fail before the place folder when a given name would overwrite a Darklua synced config", async () => {
			await write(".darklua.json");
			await write("default.rogen.json", "{}");
			await write("lobby-sync.rogen.json", "{}");
			const prompts = offerAnd();

			const result = await runInit(["lobby"], prompts);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "lobby-sync.rogen.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(1);
		});

		it("should fail before the place folder when a given name would replace a project file", async () => {
			await setUpLuau();
			await write("lobby.project.json", "{}");
			const prompts = offerAnd();

			const result = await runInit(["lobby"], prompts);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.fileExists",
					resource: path.join(cwd, "lobby.project.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(1);
		});

		it("should allow a place name whose -sync file exists when no synced config is written", async () => {
			await setUpLuau();
			await write("lobby-sync.rogen.json", "{}");

			const result = await runInit(
				[],
				offerAnd({ "Place name": "lobby" })
			);

			expect(result.isOk()).toBe(true);
		});

		it("should reject a place name that is taken", async () => {
			await setUpLuau();
			await write("lobby.rogen.json", "{}");

			await expect(
				runInit([], offerAnd({ "Place name": "lobby" }))
			).rejects.toThrow("lobby.rogen.json already exists.");
		});

		it("should leave the shared config and everything else untouched", async () => {
			await setUpLuau();
			const defaultConfig = await read("default.rogen.json");

			await runInit([], offerAnd({ "Place name": "lobby" }));

			expect(await read("default.rogen.json")).toBe(defaultConfig);
			expect(await exists("template.project.json")).toBe(false);
		});

		it("should print what to do next, including the missing include", async () => {
			await write("tsconfig.json", "{}");
			await write("src/A.ts");
			await write(
				"default.rogen.json",
				JSON.stringify({
					rootDirs: ["src"],
					routes: LUAU_ROUTES,
					syncDir: "out",
				})
			);
			const logService = new MockLogService();

			await runInit([], offerAnd({ "Place name": "lobby" }), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: ",
				"success: Created lobby.rogen.json.",
				"success: Created places/lobby/template.project.json.",
				"success: Created tsconfig.lobby.json.",
				"success: Created places/lobby/src/.",
				"success: lobby.project.json · wrote",
				"step: Next steps",
				'info: Add "include": ["src"] to tsconfig.json, so its own build leaves out the place folders.',
				"info: Run each in its own terminal:",
				"info:   rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
				"info:   rogen serve",
				'info: Declare variants under "variants" in lobby.rogen.json to swap in files like Analytics.mock.ts, and turn them on in a mode or with --variant.',
				"outro: Wrote 3 files.",
			]);
		});

		it("should fall through to the full flow when declined", async () => {
			await setUpLuau();
			const prompts = new MockPromptService({
				[WHAT_TO_ADD]: "separate",
				"Config name": "test",
			});

			await runInit([], prompts);

			expect(prompts.asked.slice(1, 3)).toEqual([
				"Config name",
				"Language",
			]);
			expect((await readJson("test.rogen.json")).routes).toEqual(
				LUAU_ROUTES
			);
			expect((await readJson("test.rogen.json")).extends).toBeUndefined();
		});

		it("should reject a taken name at the prompt when declined", async () => {
			await setUpLuau();
			await write("test.rogen.json", "{}");

			await expect(
				runInit([], new MockPromptService(["separate", "test"]))
			).rejects.toThrow("test.rogen.json already exists.");
		});

		it("should use the given name for the full flow when declined", async () => {
			await setUpLuau();
			const prompts = new MockPromptService({
				[WHAT_TO_ADD]: "separate",
			});

			await runInit(["test"], prompts);

			expect(prompts.asked).not.toContain("Config name");
			expect(await exists("test.rogen.json")).toBe(true);
		});

		it("should write nothing when cancelled at the place folder", async () => {
			await setUpLuau();

			const result = await runInit(
				[],
				offerAnd({ "Place name": "lobby", "Place folder": CANCEL })
			);

			expect(result.isErr()).toBe(true);
			expect(await exists("lobby.rogen.json")).toBe(false);
		});
	});

	describe("several places", () => {
		it("should write default and one config per detected place without a terminal", async () => {
			await write("src/A.luau");
			await write("places/lobby/B.luau");
			await write("places/match/C.luau");

			const result = await runInit();

			expect(result.isOk()).toBe(true);
			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"src",
			]);
			expect(await readJson("lobby.rogen.json")).toEqual({
				$schema: SCHEMA_URL,
				extends: "./default.rogen.json",
				rootDirs: ["places/lobby"],
				template: "places/lobby.template.project.json",
			});
			expect(await readJson("match.rogen.json")).toMatchObject({
				rootDirs: ["places/match"],
				template: "places/match.template.project.json",
			});
			expect(
				await readJson("places/match.template.project.json")
			).toEqual({
				name: "Match",
				servePort: 34874,
				tree: { $className: "DataModel" },
			});
		});

		it("should not take the shared folder for a place", async () => {
			await write("places/shared/src/Types.luau");
			await write("places/lobby/src/Queue.luau");

			await runInit();

			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"places/shared/src",
			]);
			expect(await exists("shared.rogen.json")).toBe(false);
			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"places/lobby/src",
			]);
		});

		it("should put the shared code in places/shared by default, beside the places", async () => {
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				Places: "lobby, arena",
			});

			const result = await runInit([], prompts);

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toContain("Shared code");
			expect(prompts.asked).not.toContain("Root dirs");
			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"places/shared/src",
			]);
			expect(await readJson("arena.rogen.json")).toMatchObject({
				rootDirs: ["places/arena/src"],
				template: "places/arena/template.project.json",
			});
			expect(
				await readJson("places/arena/template.project.json")
			).toEqual({
				name: "Arena",
				servePort: 34874,
				tree: { $className: "DataModel" },
			});
			expect(await exists("places/shared/src")).toBe(true);
			expect(await exists("places/lobby/src")).toBe(true);
		});

		it("should start the shared template in places/shared, mounting packages from there", async () => {
			await write("wally.toml");
			await write("Packages/Foo.lua");
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				Places: "lobby",
			});

			await runInit([], prompts);

			expect((await readJson("default.rogen.json")).template).toBe(
				"places/shared/template.project.json"
			);
			expect(
				await readJson("places/shared/template.project.json")
			).toMatchObject({
				tree: {
					ReplicatedStorage: {
						Packages: { $path: "../../Packages" },
					},
				},
			});
		});

		it("should use a shared template that is already there, as it is", async () => {
			await write("wally.toml");
			await write("Packages/Foo.lua");
			await write(
				"places/shared/template.project.json",
				'{ "name": "Mine" }'
			);
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				Places: "lobby",
			});

			const result = await runInit([], prompts);

			expect(result.isOk()).toBe(true);
			expect(await read("places/shared/template.project.json")).toBe(
				'{ "name": "Mine" }'
			);
			expect((await readJson("default.rogen.json")).template).toBe(
				"places/shared/template.project.json"
			);
		});

		it("should take other shared folders when that is the answer", async () => {
			await write("lib/A.luau");
			await write("common/B.luau");
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				"Shared code": "other",
				"Root dirs": "lib, common",
				Places: "lobby",
			});

			await runInit([], prompts);

			expect(prompts.asked).toContain("Root dirs");
			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"lib",
				"common",
			]);
			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"places/lobby/src",
			]);
		});

		it("should keep a detected place in its folder wherever the shared code is", async () => {
			await write("game/shared/A.luau");
			await write("places/lobby/src/B.luau");
			const prompts = new MockPromptService({
				"Shared code": "other",
				"Root dirs": "game/shared",
			});

			await runInit([], prompts);

			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"places/lobby/src",
			]);
		});

		it("should have Darklua process every place, and serve their synced configs", async () => {
			await write(".darklua.json");
			await write("places/lobby/src/A.luau");
			await write("places/arena/src/B.luau");
			const logService = new MockLogService();

			await runInit([], undefined, logService);

			expect(logService.lines).toEqual(
				expect.arrayContaining([
					"info: Have Darklua process your code into the sync dir:",
					"info:   darklua process places/shared/src dist/lobby/shared/src",
					"info:   darklua process places/arena/src dist/arena/arena/src",
					"info:   rogen serve arena-sync lobby-sync",
				])
			);
			expect(
				logService.lines.filter((line) =>
					line.includes("rojo sourcemap")
				)
			).toHaveLength(1);
		});

		it("should keep the shared code at the root when that is the answer", async () => {
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				"Shared code": "src",
				Places: "lobby",
			});

			await runInit([], prompts);

			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"src",
			]);
			expect(await readJson("lobby.rogen.json")).toMatchObject({
				rootDirs: ["places/lobby/src"],
				template: "places/lobby/template.project.json",
			});
		});

		it("should write one config when a name is given", async () => {
			await write("places/lobby/B.luau");

			await runInit(["game"]);

			expect(await exists("game.rogen.json")).toBe(true);
			expect(await exists("lobby.rogen.json")).toBe(false);
		});

		it("should write a tsconfig per roblox-ts place and compile each", async () => {
			await write("tsconfig.json", '{ "include": ["src"] }');
			await write("places/lobby/B.ts");
			await write("places/match/C.ts");
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService);

			expect(await exists("tsconfig.lobby.json")).toBe(true);
			expect(await exists("tsconfig.match.json")).toBe(true);
			expect(logService.lines).toEqual(
				expect.arrayContaining([
					"info:   rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
					"info:   rbxtsc -w -p tsconfig.match.json --rojo match.project.json",
					"info:   rogen serve",
				])
			);
		});
	});
});
