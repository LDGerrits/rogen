import { jest } from "@jest/globals";
import "../build-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { DeferredPromise } from "../../../base/async.js";
import { ResultError } from "../../../base/result.js";
import { OutputFile } from "../../../domain/build/build.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { CommandLine, parseArgs } from "../../../platform/environment/args.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";

const isStagingOf = (folder: string, file: string): boolean =>
	new OutputFile(`/repo/${folder}/default.project.json`).stagingPattern.test(
		file
	);

describe("build --watch", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let configService: CoreConfigService;
	let lifecycle: MockLifecycleService;
	let logService: MockLogService;
	let processes: MockProcessService;

	const settle = async () => {
		await jest.advanceTimersByTimeAsync(250);
		for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
	};

	const write = (file: string, body: Record<string, unknown> | string) =>
		memFs.writeFile(
			file,
			typeof body === "string" ? body : JSON.stringify(body)
		);

	const config = (extra: Record<string, unknown> = {}) => ({
		sourcePaths: ["src"],
		routes: { "*": "ReplicatedStorage" },
		...extra,
	});

	const startWatch = async (
		names: string[] = [],
		options: CommandLine["options"] = {}
	) => {
		const harness = commandHarness({
			fs: memFs,
			log: logService,
			config: configService,
			lifecycle,
			watcher,
			processes,
		});
		return harness.run("build", {
			positionals: names,
			options: { watch: true, ...options },
		});
	};

	const run = async (
		names: string[] = [],
		options: CommandLine["options"] = {}
	) => {
		void startWatch(names, options);
		await settle();
	};

	const writeProjects = async (
		...projects: [folder: string, extra?: Record<string, unknown>][]
	) => {
		for (const [folder, extra] of projects)
			await write(
				`/repo/${folder}/rogen.json`,
				config({ sourcePaths: ["../src"], ...extra })
			);
	};

	const built = async (folder = ""): Promise<string[]> => {
		const project = JSON.parse(
			await memFs.readFile(`/repo/${folder}/default.project.json`)
		);
		return Object.keys(project.tree.ReplicatedStorage ?? {}).filter(
			(key) => !key.startsWith("$")
		);
	};

	beforeEach(async () => {
		jest.useFakeTimers();
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo");
		await memFs.createDirectory("/repo/src");
		watcher = new MemoryWatcher(memFs, new NullLogService());
		lifecycle = new MockLifecycleService();
		logService = new MockLogService();
		processes = new MockProcessService();
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.7.1\n",
			stderr: "",
		});
		configService = new CoreConfigService(
			memFs,
			new MockEnvironmentService("/repo")
		);
		await write("/repo/rogen.json", config());
	});

	afterEach(async () => {
		lifecycle.shutdown();
		jest.restoreAllMocks();
		await watcher.stop();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	describe("with --json", () => {
		it("should print one JSON object per line for each build, and nothing else", async () => {
			void startWatch([], { json: true });
			await settle();
			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(
				logService.texts("print").map((line) => JSON.parse(line))
			).toEqual([
				{
					build: expect.objectContaining({
						config: "repo",
						outcome: "wrote",
					}),
				},
				{
					build: expect.objectContaining({
						config: "repo",
						outcome: "wrote",
					}),
				},
			]);
			expect(
				logService.entries.filter(({ kind }) => kind !== "print")
			).toEqual([]);
		});

		it("should print a config that breaks as a notice", async () => {
			void startWatch([], { json: true });
			await settle();
			logService.clear();

			await write("/repo/rogen.json", { extends: "base" });
			await settle();

			expect(
				logService.texts("print").map((line) => JSON.parse(line))
			).toContainEqual({
				notice: {
					kind: "broken",
					file: "/repo/rogen.json",
					keptLastValid: true,
					diagnostics: [
						expect.objectContaining({
							code: "config.removedField",
						}),
					],
				},
			});
		});
	});

	describe("with -o", () => {
		const finishRojo = async (index: number, code = 0) => {
			await settle();
			processes.spawned[index].exit({ code, signal: null });
			await settle();
		};

		it("should run Rojo's build after each write, and never pass it --watch", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();
			expect(processes.spawned).toHaveLength(1);
			expect(processes.spawned[0].args).toEqual([
				"build",
				"default.project.json",
				"--output",
				"game.rbxl",
			]);
			await finishRojo(0);

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await finishRojo(1);

			expect(processes.spawned).toHaveLength(2);
			for (const rojo of processes.spawned)
				expect(rojo.args).not.toContain("--watch");
		});

		it("should not run Rojo for a round that wrote nothing", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();
			await finishRojo(0);

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await finishRojo(1);
			await memFs.writeFile("/repo/src/A.luau", "changed");
			await settle();

			expect(processes.spawned).toHaveLength(2);
		});

		it("should report a failed run and go on watching", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();
			processes.spawned[0].print("ERROR: boom\n");
			await finishRojo(0, 1);

			expect(logService.texts("error").join("\n")).toContain(
				"'rojo build' failed (exit code 1): boom"
			);
			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			expect(processes.spawned).toHaveLength(2);
		});

		it("should end the Rojo build that runs when it stops", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();

			lifecycle.shutdown();
			await settle();

			expect(processes.spawned[0].terminated).toBe(true);
		});

		it("should run no Rojo without -o or -p", async () => {
			void startWatch();
			await settle();

			expect(processes.spawned).toEqual([]);
		});
	});

	describe("startup", () => {
		it("should write the project file once the watcher is ready", async () => {
			const ready = new DeferredPromise<void>();
			jest.spyOn(watcher, "watch").mockReturnValue(ready.p);
			await memFs.writeFile("/repo/src/A.luau", "");
			void startWatch();
			await settle();

			expect(await memFs.exists("/repo/default.project.json")).toBe(
				false
			);

			ready.complete();
			await settle();

			expect(await built()).toEqual(["A"]);
		});

		it("should start nothing when asked to shut down while the configs load", async () => {
			const watch = jest.spyOn(watcher, "watch");
			const running = startWatch();
			lifecycle.shutdown();

			const result = await running;

			expect(result.isOk()).toBe(true);
			expect(watch).not.toHaveBeenCalled();
			expect(logService.lines).toEqual([]);
		});

		it("should refuse to start when a config is invalid", async () => {
			await write("/repo/rogen.json", { extends: "base" });
			const watch = jest.spyOn(watcher, "watch");

			const result = await startWatch();

			expect(result.isErr()).toBe(true);
			expect(watch).not.toHaveBeenCalled();
		});

		it("should refuse to start when a project is named twice", async () => {
			await writeProjects(["lobby"]);
			const watch = jest.spyOn(watcher, "watch");

			const result = await startWatch(["lobby", "lobby"]);

			expect(result.isErr()).toBe(true);
			expect(watch).not.toHaveBeenCalled();
		});

		it("should watch a config that declares no routes and write its tree", async () => {
			await write("/repo/rogen.json", {
				tree: {
					$className: "DataModel",
					Workspace: { $className: "Workspace" },
				},
			});
			const watch = jest.spyOn(watcher, "watch");

			await run();

			expect(watch).toHaveBeenCalled();
			expect(
				JSON.parse(await memFs.readFile("/repo/default.project.json"))
			).toMatchObject({
				tree: { Workspace: { $className: "Workspace" } },
			});
		});

		it("should refuse to start when no project is found", async () => {
			await memFs.delete("/repo/rogen.json");

			const result = await startWatch();

			expect((result as ResultError<Error>).error.message).toContain(
				"No rogen.json found"
			);
		});

		it("should mark a project file that needs no rewrite as unchanged", async () => {
			await memFs.writeFile("/repo/src/A.luau", "");
			void startWatch();
			await settle();
			lifecycle.shutdown();
			await settle();
			lifecycle = new MockLifecycleService();
			await watcher.stop();
			logService.clear();
			configService = new CoreConfigService(
				memFs,
				new MockEnvironmentService("/repo")
			);

			void startWatch();
			await settle();

			expect(logService.lines).toContain(
				"success: default.project.json · unchanged"
			);
		});
	});

	describe("warnings", () => {
		it("should print an invalid config once", async () => {
			await writeProjects(["lobby"], ["arena"]);
			await run(["lobby", "arena"]);
			logService.clear();

			await write("/repo/arena/rogen.json", "{ broken");
			await settle();
			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(logService.texts("error")).toEqual([
				"Still building from the last valid arena/rogen.json.",
			]);
		});

		it("should print a warning once, not on every rebuild", async () => {
			await write(
				"/repo/rogen.json",
				config({ routes: { server: "ServerScriptService" } })
			);
			await memFs.writeFile("/repo/src/A.luau", "");
			await run();

			await memFs.writeFile("/repo/src/B.server.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/C.server.luau", "");
			await settle();

			expect(logService.texts("diagnosticWarning")).toHaveLength(1);
		});
	});

	describe("output", () => {
		const blocks = () => {
			const result: { title: string; lines: string[] }[] = [];
			for (const { kind, text } of logService.entries) {
				if (kind === "step")
					result.push({
						title: text.replace(/^\d\d:\d\d:\d\d · /, ""),
						lines: [],
					});
				else if (kind === "success" || kind === "error")
					result.at(-1)?.lines.push(text);
				else if (kind.startsWith("diagnostic"))
					result.at(-1)?.lines.push(`${kind}: ${text}`);
			}
			return result;
		};

		it("should open with a header naming the configs it watches", async () => {
			await writeProjects(["lobby"], ["arena"]);

			await run(["lobby", "arena"]);

			expect(logService.entries[0]).toEqual({
				kind: "intro",
				text: "rogen build --watch · lobby, arena",
			});
		});

		it("should print the initial build as one block with a result per config", async () => {
			await writeProjects(["lobby"], ["arena"]);

			await run(["lobby", "arena"]);

			expect(blocks()).toEqual([
				{
					title: "initial build",
					lines: [
						"lobby/default.project.json · wrote",
						"arena/default.project.json · wrote",
					],
				},
			]);
		});

		it("should print one block for a change that rebuilds several configs", async () => {
			await writeProjects(["lobby"], ["arena"]);
			await run(["lobby", "arena"]);
			logService.clear();

			await memFs.writeFile("/repo/src/A.luau", "");
			await memFs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(blocks()).toEqual([
				{
					title: "2 files changed",
					lines: [
						"lobby/default.project.json · wrote",
						"arena/default.project.json · wrote",
					],
				},
			]);
		});

		it("should print a block for each rebuild", async () => {
			await run();
			logService.clear();

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(blocks().map(({ title }) => title)).toEqual([
				"1 file changed",
				"1 file changed",
			]);
		});

		it("should name a config change and its reload in the header", async () => {
			await memFs.writeFile("/repo/src/A.luau", "");
			await run();
			logService.clear();

			await write(
				"/repo/rogen.json",
				config({ routes: { "*": "Workspace" } })
			);
			await settle();

			expect(blocks()).toEqual([
				{
					title: "rogen.json changed · reloaded",
					lines: ["default.project.json · wrote"],
				},
			]);
		});

		it("should nest a warning under the output that raised it", async () => {
			await write(
				"/repo/rogen.json",
				config({ routes: { server: "ServerScriptService" } })
			);
			await memFs.writeFile("/repo/src/A.luau", "");

			await run();

			const [block] = blocks();
			expect(block.lines).toEqual([
				"default.project.json · wrote",
				expect.stringMatching(
					/^diagnosticWarning: .*src\/A\.luau - warning: matched no route/
				),
			]);
		});

		it("should not print a block when a change leaves every output as it was", async () => {
			await memFs.writeFile("/repo/src/A.luau", "");
			await run();
			logService.clear();

			await write("/repo/rogen.json", config());
			await settle();

			expect(blocks()).toEqual([]);
		});

		it("should print a finished rebuild that was waiting behind a slower block when shutdown is requested", async () => {
			await memFs.createDirectory("/repo/lib");
			await writeProjects(
				["lobby"],
				["arena", { sourcePaths: ["../lib"] }]
			);
			await run(["lobby", "arena"]);
			logService.clear();
			const gate = new DeferredPromise<void>();
			const writeFile = memFs.writeFile.bind(memFs);
			jest.spyOn(memFs, "writeFile").mockImplementation(
				async (file, content) => {
					if (isStagingOf("lobby", file)) await gate.p;
					return writeFile(file, content);
				}
			);

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await memFs.writeFile("/repo/lib/B.luau", "");
			await settle();
			lifecycle.shutdown();
			gate.complete();
			await settle();

			expect(blocks()).toEqual([
				{
					title: "1 file changed",
					lines: ["lobby/default.project.json · wrote"],
				},
				{
					title: "1 file changed",
					lines: ["arena/default.project.json · wrote"],
				},
			]);
			expect(logService.entries.at(-1)).toEqual({
				kind: "outro",
				text: "Stopped watching.",
			});
		});

		describe("a failing build", () => {
			beforeEach(async () => {
				await write(
					"/repo/rogen.json",
					config({
						routes: {
							server: "ServerScriptService",
							client: "StarterGui",
							"*": "ReplicatedStorage",
						},
					})
				);
				await memFs.writeFile("/repo/src/Net/@server", "");
				await memFs.writeFile("/repo/src/Net/@client", "");
				await memFs.writeFile("/repo/src/init.luau", "");
			});

			it("should print the error under the result that failed", async () => {
				await run();

				const [block] = blocks();
				expect(block.lines).toEqual([
					"default.project.json · not written",
					expect.stringMatching(
						/^diagnosticError: .*src\/Net - error: /
					),
					expect.stringMatching(
						/^diagnosticError: .*src\/init\.luau - error: /
					),
				]);
			});

			it("should say the errors repeat when they were already printed", async () => {
				await run();
				logService.clear();

				await memFs.writeFile("/repo/src/B.luau", "");
				await settle();

				expect(blocks()).toEqual([
					{
						title: "1 file changed",
						lines: [
							"default.project.json · not written · same errors as before",
						],
					},
				]);
			});
		});

		it("should close with a result line when it stops", async () => {
			const running = startWatch();
			await settle();

			lifecycle.shutdown();
			await running;

			expect(logService.entries.at(-1)).toEqual({
				kind: "outro",
				text: "Stopped watching.",
			});
		});
	});

	describe("shutdown", () => {
		it("should resolve ok when shutdown is requested", async () => {
			const running = startWatch();
			await settle();

			lifecycle.shutdown();

			expect((await running).isOk()).toBe(true);
		});

		it("should stop the watcher when shutdown is requested", async () => {
			const running = startWatch();
			await settle();
			const stop = jest.spyOn(watcher, "stop");

			lifecycle.shutdown();
			await running;

			expect(stop).toHaveBeenCalledTimes(1);
		});

		it("should not throw when shutdown is requested twice", async () => {
			const running = startWatch();
			await settle();

			lifecycle.shutdown();
			lifecycle.shutdown();

			expect((await running).isOk()).toBe(true);
		});

		it("should not react to file changes after shutdown", async () => {
			const running = startWatch();
			await settle();
			lifecycle.shutdown();
			await running;

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built()).toEqual([]);
		});

		it("should return an error and stop the watcher when watching fails", async () => {
			jest.spyOn(watcher, "watch").mockRejectedValue(new Error("boom"));
			const stop = jest.spyOn(watcher, "stop");

			const result = await startWatch();

			expect(result.isErr()).toBe(true);
			expect(stop).toHaveBeenCalled();
		});

		it("should leave no subscription behind when watching fails", async () => {
			const watch = watcher.watch.bind(watcher);
			jest.spyOn(watcher, "watch").mockImplementation(
				async (requests, options) => {
					await watch(requests, options);
					throw new Error("boom");
				}
			);
			jest.spyOn(watcher, "stop").mockResolvedValue();
			await startWatch();
			const rename = jest.spyOn(memFs, "rename");

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(rename).not.toHaveBeenCalled();
		});
	});

	describe("flags", () => {
		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const parse = (...argv: string[]) =>
			parseArgs(argv, (command) => registry.getOptions(command), [
				...registry.getCommands().keys(),
			]);

		it("should accept projects, --watch and --json", () => {
			expect(
				parse(
					"build",
					"--watch",
					"lobby",
					"places/arena",
					"--json"
				).isOk()
			).toBe(true);
		});

		it("should reject --all", () => {
			expect(parse("build", "--watch", "--all").isErr()).toBe(true);
		});
	});
});
