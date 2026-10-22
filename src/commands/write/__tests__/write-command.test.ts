import path from "path";
import { jest } from "@jest/globals";
import "../../build/build-command.js";
import "../write-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { ReportedError } from "../../../platform/commands/commands.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const config = JSON.stringify({
	name: "Game",
	rogen: { sourcePaths: ["src"], routes: { "*": "ReplicatedStorage" } },
});

describe("write command", () => {
	let fs: MemoryFileSystemService;

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		await fs.writeFile(abs("src/A.luau"), "");
	});

	describe("with no project", () => {
		beforeEach(async () => {
			await fs.writeFile(abs("game.rogen.json"), config);
			await fs.writeFile(abs("lobby.rogen.json"), config);
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
				"success: game.project.json · wrote",
				"success: lobby.project.json · wrote",
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
			expect(log.texts("success")).toEqual(["game.project.json · wrote"]);
			expect(log.texts("error")).toEqual([
				"lobby.rogen.json · not loaded",
			]);
			expect(log.lines.at(-1)).toBe("outro: Wrote 1 of 2 project files.");
		});

		it("should write the other configs when one fails to build, and fail", async () => {
			await fs.writeFile(abs("bad/Combat/A.luau"), "");
			await fs.writeFile(abs("bad/Combat/init.meta.json"), '{"id": 1}');
			await fs.writeFile(
				abs("lobby.rogen.json"),
				JSON.stringify({
					rogen: {
						sourcePaths: ["bad"],
						routes: { "*": "ReplicatedStorage" },
					},
				})
			);
			const { run } = commandHarness({ fs });

			const result = await run("write");

			expect(result.isErr()).toBe(true);
			expect(await fs.exists(abs("game.project.json"))).toBe(true);
			expect(await fs.exists(abs("lobby.project.json"))).toBe(false);
		});

		it("should write only the configs it is given, any number of them", async () => {
			await fs.writeFile(abs("dist.rogen.json"), config);
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

		it("should print the build document with --json", async () => {
			const { run, log } = commandHarness({ fs });

			await run("write", { positionals: [], options: { json: true } });

			expect(log.json()).toEqual({
				changed: true,
				configs: [
					expect.objectContaining({
						config: "Game",
						outcome: "wrote",
						projectFile: abs("game.project.json"),
					}),
					expect.objectContaining({
						outcome: "wrote",
						projectFile: abs("lobby.project.json"),
					}),
				],
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
			"success: game.project.json · wrote",
			"info: plain.project.json · plain project, not written",
			"outro: Wrote 1 of 1 project file.",
		]);
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

	it("should name the folder's configs when none is the default, and not suggest init", async () => {
		await fs.writeFile(abs("game.rogen.json"), config);
		const { run } = commandHarness({ fs });

		const result = await run("build");

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
			await fs.writeFile(abs("lobby.rogen.json"), config);
		});

		afterEach(async () => {
			lifecycle.shutdown();
			await watcher.stop();
			jest.runOnlyPendingTimers();
			jest.useRealTimers();
		});

		it("should keep the project file of every config current", async () => {
			const { run } = commandHarness({
				fs,
				log,
				lifecycle,
				watcher,
				config: new CoreConfigService(
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
	});
});
