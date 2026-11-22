import path from "path";
import { jest } from "@jest/globals";
import "../../build/build-command.js";
import "../write-command.js";
import { agentBlock } from "../../../domain/init/agent/agent-block.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import { ReportedError } from "../../../platform/commands/commands.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { configServiceOf } from "../../../domain/config/__tests__/config-of.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const named = (name: string) =>
	JSON.stringify({
		name,
		sourcePaths: ["src"],
		routes: { "*": "ReplicatedStorage" },
	});

const config = named("Game");

const OLD = "<!-- rogen -->\n## Rogen\n\nOld.\n<!-- /rogen -->\n";
const OLD_SCRIPT =
	"// Agent Stop hook: report new Rogen diagnostics about changed files before the agent ends its turn.\n";

describe("write command", () => {
	let fs: MemoryFileSystemService;

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		await fs.writeFile(abs("src/A.luau"), "");
	});

	describe("agent rules", () => {
		beforeEach(async () => {
			await fs.writeFile(abs("default.rogen.json"), config);
			await fs.createDirectory(abs(".git"));
		});

		it("should bring an outdated Rogen block up to this version and say so", async () => {
			await fs.writeFile(abs("AGENTS.md"), `# Team\n\n${OLD}`);
			const { run, log } = commandHarness({ fs });

			await run("write");

			expect(await fs.readFile(abs("AGENTS.md"))).toBe(
				`# Team\n\n${agentBlock}`
			);
			expect(log.lines).toContain(
				"notice: Updated AGENTS.md to this version of Rogen."
			);
		});

		it("should leave it, and the hook script, alone under CI", async () => {
			await fs.writeFile(abs("AGENTS.md"), OLD);
			await fs.writeFile(
				abs(".agents/hooks/rogen-check.mjs"),
				OLD_SCRIPT
			);
			const { run, log } = commandHarness({
				fs,
				environment: Object.assign(
					new MockEnvironmentService("/repo"),
					{
						isCi: true,
					}
				),
			});

			await run("write");

			expect(await fs.readFile(abs("AGENTS.md"))).toBe(OLD);
			expect(
				await fs.readFile(abs(".agents/hooks/rogen-check.mjs"))
			).toBe(OLD_SCRIPT);
			expect(
				log.lines.filter((line) => line.startsWith("notice:"))
			).toEqual([]);
		});

		it("should update it without a notice under --json", async () => {
			await fs.writeFile(abs("AGENTS.md"), OLD);
			const { run, log } = commandHarness({ fs });

			await run("write", { options: { json: true } });

			expect(await fs.readFile(abs("AGENTS.md"))).toBe(agentBlock);
			expect(
				log.lines.filter((line) => line.startsWith("notice:"))
			).toEqual([]);
		});

		it("should name the files it updated under agentRules in the --json document", async () => {
			await fs.writeFile(abs("AGENTS.md"), OLD);
			const { run, log } = commandHarness({ fs });

			await run("write", { options: { json: true } });

			expect(log.json()).toMatchObject({
				changed: true,
				agentRules: [abs("AGENTS.md")],
			});
		});

		it("should leave it alone when the configs it was given don't load", async () => {
			await fs.writeFile(abs("AGENTS.md"), OLD);
			const { run } = commandHarness({ fs });

			await run("write", { positionals: ["nosuch"] });

			expect(await fs.readFile(abs("AGENTS.md"))).toBe(OLD);
		});

		it("should leave agentRules out of the --json document when the rules are current", async () => {
			await fs.writeFile(abs("AGENTS.md"), agentBlock);
			const { run, log } = commandHarness({ fs });

			await run("write", { options: { json: true } });

			expect(log.json()).not.toHaveProperty("agentRules");
		});
	});

	describe("with no project", () => {
		beforeEach(async () => {
			await fs.writeFile(abs("game.rogen.json"), config);
			await fs.writeFile(abs("lobby.rogen.json"), named("Lobby"));
		});

		it("should write the project file of every config of the folder", async () => {
			const { run } = commandHarness({ fs });

			const result = await run("write");

			expect(result.isOk()).toBe(true);
			expect(await fs.exists(abs("game.project.json"))).toBe(true);
			expect(await fs.exists(abs("lobby.project.json"))).toBe(true);
		});

		it("should say what it did for each config and how many it wrote", async () => {
			const { run, log } = commandHarness({ fs });

			await run("write");

			expect(log.lines).toEqual([
				"intro: rogen write",
				"success: Wrote game.project.json.",
				"success: Wrote lobby.project.json.",
				"outro: Wrote 2 of 2 project files.",
			]);
		});

		it("should say unchanged for a file already written", async () => {
			const { run, log } = commandHarness({ fs });
			await run("write");
			log.clear();

			await run("write");

			expect(log.texts("success")).toEqual([
				"game.project.json · unchanged",
				"lobby.project.json · unchanged",
			]);
			expect(log.lines.at(-1)).toBe("outro: 2 project files unchanged.");
		});

		it("should count the files it left unchanged apart from those it wrote", async () => {
			const { run, log } = commandHarness({ fs });
			await run("write");
			await fs.writeFile(abs("lobby.rogen.json"), named("Arena"));
			log.clear();

			await run("write");

			expect(log.lines.at(-1)).toBe(
				"outro: Wrote 1 of 2 project files (1 unchanged)."
			);
		});

		it("should write the other configs when one does not load, and fail", async () => {
			await fs.writeFile(abs("lobby.rogen.json"), "{ broken");
			const { run, log } = commandHarness({ fs });

			const result = await run("write");

			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
			expect(await fs.exists(abs("game.project.json"))).toBe(true);
			expect(await fs.exists(abs("lobby.project.json"))).toBe(false);
			expect(log.texts("success")).toEqual(["Wrote game.project.json."]);
			expect(log.texts("error")).toEqual([
				"lobby.rogen.json · not loaded",
			]);
			expect(log.lines.at(-1)).toBe("outro: Wrote 1 of 2 project files.");
		});

		it("should write the other configs when one fails to write, and fail", async () => {
			await fs.writeFile(abs("bad/Combat/A.luau"), "");
			await fs.writeFile(abs("bad/Combat/init.meta.json"), '{"id": 1}');
			await fs.writeFile(
				abs("lobby.rogen.json"),
				JSON.stringify({
					name: "Lobby",
					sourcePaths: ["bad"],
					routes: { "*": "ReplicatedStorage" },
				})
			);
			const { run } = commandHarness({ fs });

			const result = await run("write");

			expect(result.isErr()).toBe(true);
			expect(await fs.exists(abs("game.project.json"))).toBe(true);
			expect(await fs.exists(abs("lobby.project.json"))).toBe(false);
		});

		it("should write the next config it is given when one's project file cannot be written, and fail", async () => {
			await fs.createDirectory(abs("game.project.json"));
			const { run, log } = commandHarness({ fs });

			const result = await run("write", {
				positionals: ["game", "lobby"],
				options: {},
			});

			expect(result.isErr()).toBe(true);
			expect(await fs.isDirectory(abs("game.project.json"))).toBe(true);
			expect(await fs.exists(abs("lobby.project.json"))).toBe(true);
			expect(log.texts("success")).toEqual(["Wrote lobby.project.json."]);
		});

		it("should write only the configs it is given, any number of them", async () => {
			await fs.writeFile(abs("dist.rogen.json"), named("Dist"));
			const { run } = commandHarness({ fs });

			const result = await run("write", {
				positionals: ["game", "dist"],
				options: {},
			});

			expect(result.isOk()).toBe(true);
			expect(await fs.exists(abs("game.project.json"))).toBe(true);
			expect(await fs.exists(abs("dist.project.json"))).toBe(true);
			expect(await fs.exists(abs("lobby.project.json"))).toBe(false);
		});

		it("should print the write document with --json", async () => {
			const { run, log } = commandHarness({ fs });

			await run("write", { positionals: [], options: { json: true } });

			expect(log.json()).toEqual({
				changed: true,
				configs: [
					expect.objectContaining({
						config: "game.rogen.json",
						outcome: "wrote",
						projectFile: abs("game.project.json"),
					}),
					expect.objectContaining({
						config: "lobby.rogen.json",
						outcome: "wrote",
						projectFile: abs("lobby.project.json"),
					}),
				],
				plainProjects: [],
			});
		});
	});

	it("should leave a project file with no config alone and list it", async () => {
		await fs.writeFile(abs("game.rogen.json"), config);
		await fs.writeFile(abs("plain.project.json"), '{"name":"P","tree":{}}');
		const { run, log } = commandHarness({ fs });

		const result = await run("write");

		expect(result.isOk()).toBe(true);
		expect(await fs.readFile(abs("plain.project.json"))).toBe(
			'{"name":"P","tree":{}}'
		);
		expect(log.lines).toEqual([
			"intro: rogen write",
			"success: Wrote game.project.json.",
			"info: plain.project.json · plain project, not written",
			"outro: Wrote 1 of 1 project file.",
		]);
	});

	it("should list a project file with no config in the --json document", async () => {
		await fs.writeFile(abs("game.rogen.json"), config);
		await fs.writeFile(abs("plain.project.json"), '{"name":"P","tree":{}}');
		const { run, log } = commandHarness({ fs });

		await run("write", { positionals: [], options: { json: true } });

		expect(log.json()).toMatchObject({
			changed: true,
			plainProjects: ["plain.project.json"],
		});
	});

	it("should list a folder's only plain project in the --json document", async () => {
		await fs.writeFile(
			abs("default.project.json"),
			'{"name":"P","tree":{}}'
		);
		const { run, log } = commandHarness({ fs });

		await run("write", { positionals: [], options: { json: true } });

		expect(log.json()).toEqual({
			changed: false,
			configs: [],
			plainProjects: ["default.project.json"],
		});
	});

	it("should write nothing and succeed in a folder with only a plain project", async () => {
		await fs.writeFile(
			abs("default.project.json"),
			'{"name":"P","tree":{}}'
		);
		const { run, log } = commandHarness({ fs });

		const result = await run("write");

		expect(result.isOk()).toBe(true);
		expect(log.texts("info")).toEqual([
			"default.project.json · plain project, not written",
		]);
	});

	it("should say a named plain project is not written", async () => {
		await fs.writeFile(
			abs("default.project.json"),
			'{"name":"P","tree":{}}'
		);
		const { run, log } = commandHarness({ fs });

		await run("write", { positionals: ["default"], options: {} });

		expect(log.texts("info")).toEqual([
			"default.project.json · plain project, not written",
		]);
	});

	it("should list a named plain project in the --json document", async () => {
		await fs.writeFile(
			abs("default.project.json"),
			'{"name":"P","tree":{}}'
		);
		const { run, log } = commandHarness({ fs });

		await run("write", {
			positionals: ["default"],
			options: { json: true },
		});

		expect(log.json()).toMatchObject({
			plainProjects: ["default.project.json"],
		});
	});

	it("should write nothing when the folder's config appears only after it listed the folder", async () => {
		await fs.writeFile(abs("default.rogen.json"), config);
		const listing = jest
			.spyOn(CoreConfigService.prototype, "configsHere")
			.mockResolvedValue([]);
		const { run } = commandHarness({ fs });

		const result = await run("write");
		listing.mockRestore();

		expect(result.isOk()).toBe(true);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should fail and write nothing when a named config is not there", async () => {
		await fs.writeFile(abs("default.rogen.json"), config);
		const { run } = commandHarness({ fs });

		const result = await run("write", {
			positionals: ["missing"],
			options: {},
		});

		expect(result.isErr()).toBe(true);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should warn which config it took when a name is both a folder and a file", async () => {
		await fs.writeFile(abs("lobby/default.rogen.json"), config);
		await fs.writeFile(abs("lobby.rogen.json"), config);
		const { run, log } = commandHarness({ fs });

		await run("write", { positionals: ["lobby"], options: {} });

		expect(log.texts("warn")).toEqual([
			'"lobby" is a folder with a default config and also lobby.rogen.json: using the folder. To use the file, name it: lobby.rogen.json.',
		]);
	});

	it("should name the folder's configs when none is the default, and not suggest init", async () => {
		await fs.writeFile(abs("game.rogen.json"), config);
		const { run } = commandHarness({ fs });

		const result = await run("build", {
			positionals: [],
			options: { output: "game.rbxl" },
		});

		const { error } = result as ResultError<Error>;
		expect(error).toMatchObject({
			hint: "Name one of them, or run 'rogen write' to write them all.",
		});
	});

	it("should fail in a folder with no config, and suggest init", async () => {
		const { run } = commandHarness({ fs });

		const result = await run("write");

		const { error } = result as ResultError<Error>;
		expect(error.message).toContain("No default.rogen.json");
		expect(error).toMatchObject({
			hint: "Run 'rogen init' to create one.",
		});
	});

	describe("--watch", () => {
		let watcher: MemoryWatcher;
		let lifecycle: MockLifecycleService;
		let log: MockLogService;

		const settle = async () => {
			await jest.advanceTimersByTimeAsync(250);
			for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
		};

		beforeEach(async () => {
			jest.useFakeTimers();
			watcher = new MemoryWatcher(fs, new NullLogService());
			lifecycle = new MockLifecycleService();
			log = new MockLogService();
			await fs.writeFile(abs("game.rogen.json"), config);
			await fs.writeFile(abs("lobby.rogen.json"), named("Lobby"));
		});

		afterEach(async () => {
			lifecycle.shutdown();
			await watcher.stop();
			jest.runOnlyPendingTimers();
			jest.useRealTimers();
		});

		it("should print the agent files it updated as an agentRules line under --json", async () => {
			await fs.createDirectory(abs(".git"));
			await fs.writeFile(abs("AGENTS.md"), OLD);
			const { run } = commandHarness({
				fs,
				log,
				lifecycle,
				watcher,
				config: configServiceOf(
					fs,
					new MockEnvironmentService("/repo")
				),
			});
			void run("write", {
				positionals: [],
				options: { watch: true, json: true },
			});
			await settle();

			expect(
				log
					.texts("print")
					.map((text) => JSON.parse(text))
					.filter((line) => "agentRules" in line)
			).toEqual([{ agentRules: [abs("AGENTS.md")] }]);
		});

		it("should keep the project file of every config current", async () => {
			const { run } = commandHarness({
				fs,
				log,
				lifecycle,
				watcher,
				config: configServiceOf(
					fs,
					new MockEnvironmentService("/repo")
				),
			});
			void run("write", { positionals: [], options: { watch: true } });
			await settle();
			const listed = (file: string) =>
				fs
					.readFile(abs(file))
					.then((text) =>
						Object.keys(
							JSON.parse(text).tree.ReplicatedStorage ?? {}
						).filter((key) => !key.startsWith("$"))
					);
			expect(await listed("game.project.json")).toEqual(["A"]);

			await fs.writeFile(abs("src/B.luau"), "");
			await settle();

			expect(await listed("game.project.json")).toEqual(["A", "B"]);
			expect(await listed("lobby.project.json")).toEqual(["A", "B"]);
			expect(log.entries[0].text).toMatch(/^rogen write --watch/);
		});

		it("should write a config added to the folder, and stop writing one removed from it", async () => {
			const { run } = commandHarness({
				fs,
				log,
				lifecycle,
				watcher,
				config: configServiceOf(
					fs,
					new MockEnvironmentService("/repo")
				),
			});
			void run("write", {
				positionals: [],
				options: { watch: true, json: true },
			});
			await settle();

			await fs.writeFile(abs("arena.rogen.json"), named("Arena"));
			await settle();
			await fs.delete(abs("lobby.rogen.json"));
			await settle();

			const printed = log
				.texts("print")
				.map((text) => JSON.parse(text))
				.filter((line) => "notice" in line);
			expect(printed).toEqual([
				{ notice: { kind: "added", config: "arena.rogen.json" } },
				{ notice: { kind: "removed", config: "lobby.rogen.json" } },
			]);
			expect(await fs.exists(abs("arena.project.json"))).toBe(true);
		});

		it("should watch the default config it is given from another folder", async () => {
			await fs.writeFile(
				abs("places/lobby/default.rogen.json"),
				JSON.stringify({
					name: "Lobby",
					sourcePaths: ["../../src"],
					routes: { "*": "ReplicatedStorage" },
				})
			);
			const { run } = commandHarness({
				fs,
				log,
				lifecycle,
				watcher,
				config: configServiceOf(
					fs,
					new MockEnvironmentService("/repo")
				),
			});
			void run("write", {
				positionals: ["places/lobby/default.rogen.json"],
				options: { watch: true },
			});
			await settle();

			expect(
				await fs.exists(abs("places/lobby/default.project.json"))
			).toBe(true);
		});

		it("should write a config added to a folder that held only a plain project file, and leave that file alone", async () => {
			await fs.delete(abs("game.rogen.json"));
			await fs.delete(abs("lobby.rogen.json"));
			const plain = JSON.stringify({ name: "Plain", tree: {} });
			await fs.writeFile(abs("default.project.json"), plain);
			const { run } = commandHarness({
				fs,
				log,
				lifecycle,
				watcher,
				config: configServiceOf(
					fs,
					new MockEnvironmentService("/repo")
				),
			});
			void run("write", {
				positionals: [],
				options: { watch: true, json: true },
			});
			await settle();

			await fs.writeFile(abs("arena.rogen.json"), named("Arena"));
			await settle();

			expect(
				log
					.texts("print")
					.map((text) => JSON.parse(text))
					.filter((line) => "notice" in line)
			).toEqual([
				{ notice: { kind: "added", config: "arena.rogen.json" } },
			]);
			expect(await fs.exists(abs("arena.project.json"))).toBe(true);
			expect(await fs.readFile(abs("default.project.json"))).toBe(plain);
		});
	});
});
