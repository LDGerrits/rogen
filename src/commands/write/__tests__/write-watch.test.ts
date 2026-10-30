import { jest } from "@jest/globals";
import "../../build/build-command.js";
import "../write-command.js";
import "../../sourcemap/sourcemap-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { DeferredPromise } from "../../../base/async.js";
import { ResultError } from "../../../base/result.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { exitCodeOf } from "../../../platform/commands/command-failure.js";

describe("watch", () => {
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

	const config = (fields: Record<string, unknown> = {}) => ({
		sourcePaths: ["src"],
		routes: { "*": "ReplicatedStorage" },
		...fields,
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
		const withRojo =
			options.output !== undefined || options.plugin !== undefined;
		return harness.run(withRojo ? "build" : "write", {
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
				`/repo/${folder}/default.rogen.json`,
				config({ ...extra, sourcePaths: ["../src"] })
			);
	};

	const placed = async (folder = ""): Promise<string[]> => {
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
		await write("/repo/default.rogen.json", config());
	});

	afterEach(async () => {
		lifecycle.shutdown();
		jest.restoreAllMocks();
		await watcher.stop();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	describe("with --json", () => {
		it("should print one JSON object per line for each write, and nothing else", async () => {
			void startWatch([], { json: true });
			await settle();
			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(
				logService.texts("print").map((line) => JSON.parse(line))
			).toEqual([
				{
					write: expect.objectContaining({
						config: "default.rogen.json",
						outcome: "wrote",
					}),
				},
				{
					write: expect.objectContaining({
						config: "default.rogen.json",
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

			await write("/repo/default.rogen.json", { bogus: "base" });
			await settle();

			expect(
				logService.texts("print").map((line) => JSON.parse(line))
			).toContainEqual({
				notice: {
					kind: "broken",
					config: "default.rogen.json",
					keptLastValid: true,
					diagnostics: [
						expect.objectContaining({
							code: "config.unknownField",
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

		it("should start Rojo's own build --watch once, and leave the rewrites to it", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/A.luau", "changed");
			await settle();

			expect(processes.spawned.map(({ args }) => args)).toEqual([
				[
					"build",
					"default.project.json",
					"--output",
					"game.rbxl",
					"--watch",
				],
			]);
			expect(processes.spawned[0].terminated).toBe(false);
		});

		it("should refuse to start when Rojo has several projects to run on", async () => {
			await memFs.createDirectory("/repo/a");
			await memFs.createDirectory("/repo/b");
			await write(
				"/repo/a/default.rogen.json",
				config({ sourcePaths: ["../src"] })
			);
			await write(
				"/repo/b/default.rogen.json",
				config({ sourcePaths: ["../src"] })
			);

			const result = await startWatch(["a", "b"], { output: "g.rbxl" });

			expect(result.isErr()).toBe(true);
			expect(processes.spawned).toEqual([]);
		});

		it("should say in its own line what Rojo built, once per build, in place of Rojo's lines", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();
			const rojo = processes.spawned[0];

			rojo.print("Building project 'repo'\nBuilt project to game.rbxl\n");
			rojo.print("Building project 'repo'\nBuilt project to game.rbxl\n");
			await settle();

			expect(logService.reserved).toBe(false);
			expect(logService.texts("success")).toEqual([
				"default.project.json · wrote",
				"Built game.rbxl.",
				"Built game.rbxl.",
			]);
			expect(logService.lines.join("\n")).not.toContain(
				"Building project"
			);
		});

		it("should report an error Rojo prints while it watches, and go on watching", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();
			const rojo = processes.spawned[0];
			rojo.print("Built project to game.rbxl\n");

			rojo.printError(
				"[ERROR librojo::change_processor] File is not a valid JSON model: /repo/src/Bad.model.json\n"
			);
			await settle();
			rojo.print("Built project to game.rbxl\n");
			await settle();

			expect(logService.texts("diagnosticError").join("\n")).toContain(
				"Rojo couldn't build this project: (rojo.commandFailed)\n  File is not a valid JSON model"
			);
			expect(rojo.terminated).toBe(false);
			expect(logService.texts("success").at(-1)).toBe("Built game.rbxl.");
		});

		it("should stop with exit code 1 when Rojo stops on its own, as its first build failing does", async () => {
			const running = startWatch([], { output: "game.rbxl" });
			await settle();

			processes.spawned[0].printError("ERROR: boom\n");
			await finishRojo(0, 1);
			const result = await running;

			expect(result.isErr() && exitCodeOf(result.error)).toBe(1);
			expect(logService.texts("diagnosticError").join("\n")).toContain(
				"Rojo stopped watching repo (exit code 1)."
			);
			expect(processes.spawned).toHaveLength(1);
		});

		it("should start Rojo once the first write succeeds, when the project can't be written at first", async () => {
			await write(
				"/repo/default.rogen.json",
				config({ sourcePaths: ["later"] })
			);
			void startWatch([], { output: "game.rbxl" });
			await settle();
			expect(processes.spawned).toEqual([]);

			await memFs.writeFile("/repo/later/A.luau", "");
			await settle();

			expect(processes.spawned).toHaveLength(1);
		});

		it("should write the project file again and restart Rojo when it crashes after a build", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();
			processes.spawned[0].print("Built project to game.rbxl\n");
			await memFs.delete("/repo/default.project.json");

			processes.spawned[0].printError("[ERROR rojo] Rojo crashed!\n");
			await finishRojo(0, 1);

			expect(processes.spawned).toHaveLength(2);
			expect(processes.spawned[1].args).toEqual(
				processes.spawned[0].args
			);
			expect(await memFs.exists("/repo/default.project.json")).toBe(true);
			expect(logService.texts("info")).toContain(
				"Rojo crashed, so Rogen restarted it."
			);
			expect(logService.texts("diagnosticError")).toEqual([]);
		});

		it("should give up with rojo.crashed when the restarted Rojo crashes before it builds", async () => {
			const running = startWatch([], { output: "game.rbxl" });
			await settle();
			processes.spawned[0].print("Built project to game.rbxl\n");
			processes.spawned[0].printError("[ERROR rojo] Rojo crashed!\n");
			await finishRojo(0, 1);

			processes.spawned[1].printError("[ERROR rojo] Rojo crashed!\n");
			await finishRojo(1, 1);
			const result = await running;

			expect(result.isErr() && exitCodeOf(result.error)).toBe(1);
			expect(logService.texts("diagnosticError").join("\n")).toContain(
				"Rojo crashed again right after a restart, so Rogen stopped watching repo: (rojo.crashed)"
			);
		});

		it("should end the Rojo that watches when it stops", async () => {
			void startWatch([], { output: "game.rbxl" });
			await settle();

			lifecycle.shutdown();
			await settle();

			expect(processes.spawned[0].terminated).toBe(true);
		});

		it.each([
			["SIGINT", 130],
			["SIGTERM", 143],
		] as const)(
			"should exit as a shell reports %s when it stops by it",
			async (signal, code) => {
				const running = startWatch([], { output: "game.rbxl" });
				await settle();

				lifecycle.shutdown(signal);
				const result = await running;

				expect(result.isErr() && exitCodeOf(result.error)).toBe(code);
				expect(logService.entries.at(-1)).toEqual({
					kind: "outro",
					text: "Stopped watching.",
				});
			}
		);

		it("should print a line for each Rojo build with --json", async () => {
			void startWatch([], { output: "game.rbxl", json: true });
			await settle();
			const rojo = processes.spawned[0];

			rojo.print("Building project 'repo'\nBuilt project to game.rbxl\n");
			rojo.printError("[ERROR librojo::change_processor] boom\n");
			await settle();

			const lines = logService
				.texts("print")
				.map((line) => JSON.parse(line));
			expect(lines.slice(1)).toEqual([
				{
					rojo: expect.objectContaining({
						command: "build",
						outcome: "built",
						output: "/repo/game.rbxl",
					}),
				},
				{
					rojo: expect.objectContaining({
						command: "build",
						outcome: "failed",
						messages: [{ severity: "error", text: "boom" }],
					}),
				},
			]);
		});

		it("should print each sourcemap Rojo prints without -o, as it prints it, and nothing else on stdout", async () => {
			void commandHarness({
				fs: memFs,
				log: logService,
				config: configService,
				lifecycle,
				watcher,
				processes,
			}).run("sourcemap", { positionals: [], options: { watch: true } });
			await settle();
			const rojo = processes.spawned[0];

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			rojo.print('{"name":"repo"}\n');
			await settle();

			expect(rojo.args).toEqual([
				"sourcemap",
				"default.project.json",
				"--watch",
			]);
			expect(logService.reserved).toBe(true);
			expect(logService.texts("print")).toEqual(['{"name":"repo"}']);
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

			expect(await placed()).toEqual(["A"]);
		});

		it("should start nothing when asked to shut down while the configs load", async () => {
			const watch = jest.spyOn(watcher, "watch");
			const running = startWatch([], { output: "game.rbxl" });
			lifecycle.shutdown();

			const result = await running;

			expect(result.isOk()).toBe(true);
			expect(watch).not.toHaveBeenCalled();
			expect(logService.lines).toEqual([]);
		});

		it("should refuse to start when a config is invalid", async () => {
			await write("/repo/default.rogen.json", { bogus: "base" });
			const watch = jest.spyOn(watcher, "watch");

			const result = await startWatch();

			expect(result.isErr()).toBe(true);
			expect(watch).not.toHaveBeenCalled();
		});

		it("should refuse to start when two projects are named, as Rojo's own command does", async () => {
			await writeProjects(["lobby"], ["arena"]);
			const watch = jest.spyOn(watcher, "watch");

			const result = await startWatch(["lobby", "arena"], {
				output: "game.rbxl",
			});

			expect((result as ResultError<Error>).error.message).toContain(
				"unexpected argument 'arena'"
			);
			expect(watch).not.toHaveBeenCalled();
		});

		it("should refuse to start when no project is found", async () => {
			await memFs.delete("/repo/default.rogen.json");

			const result = await startWatch();

			expect((result as ResultError<Error>).error.message).toContain(
				"No default.rogen.json or default.project.json in this folder"
			);
		});

		const restartUnchanged = async (
			options: CommandLine["options"] = {}
		) => {
			await memFs.writeFile("/repo/src/A.luau", "");
			void startWatch([], options);
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
			void startWatch([], options);
			await settle();
		};

		it("should print nothing for a round that leaves the project file unchanged", async () => {
			await restartUnchanged({ output: "game.rbxl" });

			expect(logService.lines).not.toContainEqual(
				expect.stringContaining("unchanged")
			);
			expect(logService.texts("step")).toEqual([]);
		});

		it("should mark a project file that needs no rewrite as unchanged under -v", async () => {
			logService.setLevel(LogLevel.Debug);

			await restartUnchanged();

			expect(logService.lines).toContain(
				"debug: default.project.json · unchanged"
			);
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
			await writeProjects(["lobby"]);

			await run(["lobby"]);

			expect(logService.entries[0]).toEqual({
				kind: "intro",
				text: "rogen write --watch · lobby/default.rogen.json",
			});
		});

		it("should print the initial write as one block with a result", async () => {
			await writeProjects(["lobby"]);

			await run(["lobby"]);

			expect(blocks()).toEqual([
				{
					title: "initial write",
					lines: ["lobby/default.project.json · wrote"],
				},
			]);
		});

		it("should print a block for each rewrite", async () => {
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

		it("should not print a block when a change leaves every output as it was", async () => {
			await memFs.writeFile("/repo/src/A.luau", "");
			await run();
			logService.clear();

			await write("/repo/default.rogen.json", config());
			await settle();

			expect(blocks()).toEqual([]);
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

			expect(await placed()).toEqual([]);
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
});
