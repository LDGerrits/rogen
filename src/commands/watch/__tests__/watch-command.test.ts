import { jest } from "@jest/globals";
import "../watch-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { DeferredPromise } from "../../../base/async.js";
import { DisposableStore } from "../../../base/disposable.js";
import { ResultError } from "../../../base/result.js";
import { OutputFile } from "../../../domain/build/build.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { parseArgs } from "../../../platform/environment/args.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";

const isDefaultStaging = (file: string): boolean =>
	new OutputFile("/repo/default.project.json").stagingPattern.test(file);

describe("watch command", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let configService: CoreConfigService;
	let store: DisposableStore;
	let lifecycle: MockLifecycleService;
	let logService: MockLogService;

	const settle = async () => {
		await jest.advanceTimersByTimeAsync(150);
		for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
	};

	const write = (file: string, body: Record<string, unknown> | string) =>
		memFs.writeFile(
			file,
			typeof body === "string" ? body : JSON.stringify(body)
		);

	const config = (extra: Record<string, unknown> = {}) => ({
		rootDirs: ["src"],
		routes: { "*": "ReplicatedStorage" },
		...extra,
	});

	const startWatch = async (names: string[] = []) => {
		const harness = commandHarness({
			fs: memFs,
			log: logService,
			config: configService,
			lifecycle,
			watcher,
		});
		return harness.run("watch", { positionals: names });
	};

	const run = async (names: string[] = []) => {
		void startWatch(names);
		await settle();
	};

	const built = async (name: string): Promise<string[]> => {
		const project = JSON.parse(
			await memFs.readFile(`/repo/${name}.project.json`)
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
		store = new DisposableStore();
		lifecycle = new MockLifecycleService();
		logService = new MockLogService();
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
		store[Symbol.dispose]();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
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

			expect(await built("default")).toEqual(["A"]);
		});

		it("should watch every config here when none is named", async () => {
			await write("/repo/source.rogen.json", config());
			void startWatch([]);
			await settle();

			expect(logService.lines[0]).toBe(
				"intro: rogen watch · default, source"
			);
		});

		it("should refuse to start when a config is invalid", async () => {
			await write("/repo/default.rogen.json", '{"nope": 1}');
			const watch = jest.spyOn(watcher, "watch");

			const result = await startWatch();

			expect(result.isErr()).toBe(true);
			expect(watch).not.toHaveBeenCalled();
		});

		it("should refuse to start when two configs write the same file", async () => {
			await write(
				"/repo/source.rogen.json",
				config({ outFile: "default.project.json" })
			);
			const watch = jest.spyOn(watcher, "watch");

			const result = await startWatch(["default", "source"]);

			expect(result.isErr()).toBe(true);
			expect(watch).not.toHaveBeenCalled();
		});

		it("should refuse to start when a config declares no routes", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["src"] });

			const result = await startWatch();

			expect((result as ResultError<Error>).error.message).toContain(
				"no routes declared"
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
			await write("/repo/prod.rogen.json", config());
			await run(["default", "prod"]);
			logService.clear();

			await write("/repo/prod.rogen.json", "{ broken");
			await settle();
			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(
				logService.entries.filter(({ kind }) => kind === "error")
			).toEqual([
				{
					kind: "error",
					text: "Still building from the last valid prod.rogen.json.",
				},
			]);
		});

		it("should print a warning once, not on every rebuild", async () => {
			await write(
				"/repo/default.rogen.json",
				config({ routes: { server: "ServerScriptService" } })
			);
			await memFs.writeFile("/repo/src/A.luau", "");
			await run();

			await memFs.writeFile("/repo/src/B.server.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/C.server.luau", "");
			await settle();

			expect(
				logService.entries.filter(
					({ kind }) => kind === "diagnosticWarning"
				)
			).toHaveLength(1);
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
			await write("/repo/source.rogen.json", config());

			await run(["default", "source"]);

			expect(logService.entries[0]).toEqual({
				kind: "intro",
				text: "rogen watch · default, source",
			});
		});

		it("should print the initial build as one block with a result per config", async () => {
			await write("/repo/source.rogen.json", config());

			await run(["default", "source"]);

			expect(blocks()).toEqual([
				{
					title: "initial build",
					lines: [
						"default.project.json · wrote",
						"source.project.json · wrote",
					],
				},
			]);
		});

		it("should print one block for a change that rebuilds several configs", async () => {
			await write("/repo/source.rogen.json", config());
			await run(["default", "source"]);
			logService.clear();

			await memFs.writeFile("/repo/src/A.luau", "");
			await memFs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(blocks()).toEqual([
				{
					title: "2 files changed",
					lines: [
						"default.project.json · wrote",
						"source.project.json · wrote",
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
				"/repo/default.rogen.json",
				config({ routes: { "*": "Workspace" } })
			);
			await settle();

			expect(blocks()).toEqual([
				{
					title: "default.rogen.json changed · reloaded",
					lines: ["default.project.json · wrote"],
				},
			]);
		});

		it("should nest a warning under the output that raised it", async () => {
			await write(
				"/repo/default.rogen.json",
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

			await write("/repo/default.rogen.json", config());
			await settle();

			expect(blocks()).toEqual([]);
		});

		it("should print a finished rebuild that was waiting behind a slower block when shutdown is requested", async () => {
			await memFs.createDirectory("/repo/lib");
			await write(
				"/repo/source.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await run(["default", "source"]);
			logService.clear();
			const gate = new DeferredPromise<void>();
			const writeFile = memFs.writeFile.bind(memFs);
			jest.spyOn(memFs, "writeFile").mockImplementation(
				async (file, content) => {
					if (isDefaultStaging(file)) await gate.p;
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
					lines: ["default.project.json · wrote"],
				},
				{
					title: "1 file changed",
					lines: ["source.project.json · wrote"],
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
					"/repo/default.rogen.json",
					config({
						variants: ["dev", "mock"],
						mode: "qa",
						modes: { qa: { variants: ["dev", "mock"] } },
					})
				);
				await memFs.writeFile("/repo/src/Analytics.dev.luau", "");
				await memFs.writeFile("/repo/src/Analytics.mock.luau", "");
			});

			it("should print the error under the result that failed", async () => {
				await run();

				const [block] = blocks();
				expect(block.lines).toEqual([
					"default.project.json · not written · mode qa",
					expect.stringMatching(
						/^diagnosticError: .*Analytics\.dev\.luau - error: /
					),
					expect.stringMatching(
						/^diagnosticError: .*Analytics\.mock\.luau - error: /
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
							"default.project.json · not written · mode qa · same errors as before",
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

			expect(await built("default")).toEqual([]);
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
			// Keeps the watcher reporting, so only the session's own subscriptions can react.
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

		it("should accept the override flags, but not --json", () => {
			expect(
				parse(
					"watch",
					"a.rogen.json",
					"--variant",
					"mock",
					"-o",
					"x"
				).isOk()
			).toBe(true);
			expect(parse("watch", "--json").isErr()).toBe(true);
		});

		it("should reject --all", () => {
			expect(parse("watch", "--all").isErr()).toBe(true);
		});
	});
});
