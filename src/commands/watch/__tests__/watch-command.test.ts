import { jest } from "@jest/globals";
import "../watch-command.js";
import "../../../domain/config/config.js";
import { DeferredPromise } from "../../../base/async.js";
import { DisposableStore } from "../../../base/disposable.js";
import { ResultError } from "../../../base/result.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import {
	FileChange,
	FileChangeType,
} from "../../../platform/fs/file-events.js";
import {
	FileSystemService,
	FileType,
} from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { LifecycleService } from "../../../platform/lifecycle/lifecycle-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";
import { CoreReconciliationService } from "../../../platform/watcher/core-reconciliation-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { ReconciliationService } from "../../../platform/watcher/reconciliation-service.js";
import { Watcher } from "../../../platform/watcher/watcher.js";

describe("watch command", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let reconciliation: CoreReconciliationService;
	let configService: CoreConfigService;
	let store: DisposableStore;
	let lifecycle: MockLifecycleService;
	let logService: NullLogService;

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
		await configService.initialize({ names, paths: [] });
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(Watcher, watcher);
		services.set(ReconciliationService, reconciliation);
		services.set(ConfigService, configService);
		services.set(FileSystemService, memFs);
		services.set(LifecycleService, lifecycle);
		services.set(IndexService, store.add(new CoreIndexService(memFs)));
		services.set(
			EnvironmentService,
			new MockEnvironmentService(undefined, "/repo")
		);
		return store
			.add(new CoreCommandService(services, logService))
			.executeCommand("watch", { _: ["watch"] });
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

	const emitted = () => {
		const batches: FileChange[][] = [];
		store.add(reconciliation.onDidEmitChanges((c) => batches.push(c)));
		return batches;
	};

	beforeEach(async () => {
		jest.useFakeTimers();
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo");
		await memFs.createDirectory("/repo/src");
		watcher = new MemoryWatcher(memFs, new NullLogService());
		store = new DisposableStore();
		lifecycle = new MockLifecycleService();
		logService = new NullLogService();
		reconciliation = new CoreReconciliationService(logService, {
			burstThreshold: 200,
			debounceMs: 100,
		});
		configService = new CoreConfigService(
			memFs,
			new MockEnvironmentService(undefined, "/repo"),
			logService
		);
		await write("/repo/default.rogen.json", config());
	});

	afterEach(async () => {
		lifecycle.shutdown();
		jest.restoreAllMocks();
		await watcher.stop();
		reconciliation[Symbol.dispose]();
		configService[Symbol.dispose]();
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

		it("should name the configs here that it was not asked to watch", async () => {
			await write("/repo/source.rogen.json", config());
			const info = jest.spyOn(logService, "info");
			void startWatch(["default"]);
			await settle();

			expect(info).toHaveBeenCalledWith(
				"Not building: source.rogen.json."
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

		it("should report that an unchanged project file is up to date", async () => {
			await memFs.writeFile("/repo/src/A.luau", "");
			void startWatch();
			await settle();
			lifecycle.shutdown();
			await settle();
			lifecycle = new MockLifecycleService();
			await watcher.stop();
			const info = jest.spyOn(logService, "info");
			configService = new CoreConfigService(
				memFs,
				new MockEnvironmentService(undefined, "/repo"),
				logService
			);

			void startWatch();
			await settle();

			expect(info).toHaveBeenCalledWith(
				"default.project.json is up to date."
			);
		});
	});

	describe("watching", () => {
		it("should watch two configs that share a root through one watcher call and one directory", async () => {
			await write("/repo/source.rogen.json", config());
			const watch = jest.spyOn(watcher, "watch");

			await run(["default", "source"]);

			expect(watch).toHaveBeenCalledTimes(1);
			const [requests] = watch.mock.calls[0];
			expect(requests.filter((r) => r.recursive)).toEqual([
				{ path: "/repo/src", recursive: true },
			]);
		});

		it("should drop a root that lies inside another", async () => {
			await write(
				"/repo/lobby.rogen.json",
				config({ rootDirs: ["src/shared"] })
			);
			const watch = jest.spyOn(watcher, "watch");

			await run(["default", "lobby"]);

			const [requests] = watch.mock.calls[0];
			expect(requests.filter((r) => r.recursive)).toEqual([
				{ path: "/repo/src", recursive: true },
			]);
		});

		it("should not watch the parent that two roots share", async () => {
			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["places/a", "places/b"] })
			);
			const watch = jest.spyOn(watcher, "watch");

			await run();

			const [requests] = watch.mock.calls[0];
			expect(requests.filter((r) => r.recursive)).toEqual([
				{ path: "/repo/places/a", recursive: true },
				{ path: "/repo/places/b", recursive: true },
			]);
		});

		it("should tell the watcher to skip each output file and sync directory", async () => {
			await write("/repo/default.rogen.json", config({ syncDir: "out" }));
			const watch = jest.spyOn(watcher, "watch");

			await run();

			const [, options] = watch.mock.calls[0];
			expect(options?.ignored).toEqual([
				"/repo/default.project.json",
				"/repo/default.project.json.tmp",
				"/repo/out",
			]);
		});

		it("should emit one batch for one change to a root shared by two configs", async () => {
			await write("/repo/source.rogen.json", config());
			await run(["default", "source"]);
			const batches = emitted();

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(batches).toHaveLength(1);
		});

		it("should not rebuild off its own write to a watched root", async () => {
			await write(
				"/repo/default.rogen.json",
				config({ outFile: "src/out.project.json" })
			);
			await run();
			const batches = emitted();

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(batches).toHaveLength(1);
			expect(batches[0].map((c) => c.path)).toEqual(["/repo/src/A.luau"]);
		});
	});

	describe("source changes", () => {
		it("should add a new source file to the project file", async () => {
			await run();

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built("default")).toEqual(["A"]);
		});

		it("should drop the removal of a source file from the project file", async () => {
			await memFs.writeFile("/repo/src/A.luau", "");
			await run();

			await memFs.delete("/repo/src/A.luau");
			await settle();

			expect(await built("default")).toEqual([]);
		});

		it("should not queue an update to a source file", async () => {
			await memFs.writeFile("/repo/src/A.luau", "");
			await run();
			const queueEvents = jest.spyOn(reconciliation, "queueEvents");

			await memFs.writeFile("/repo/src/A.luau", "-- edited");
			await settle();

			expect(queueEvents).not.toHaveBeenCalled();
		});

		it("should reach every config that claims the path, each once", async () => {
			await write("/repo/source.rogen.json", config());
			await run(["default", "source"]);
			const rename = jest.spyOn(memFs, "rename");

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built("default")).toEqual(["A"]);
			expect(await built("source")).toEqual(["A"]);
			expect(rename.mock.calls.map(([, to]) => to).sort()).toEqual([
				"/repo/default.project.json",
				"/repo/source.project.json",
			]);
		});

		it("should reach only the configs whose roots contain the path", async () => {
			await memFs.createDirectory("/repo/lib");
			await write(
				"/repo/lobby.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await run(["default", "lobby"]);
			const rename = jest.spyOn(memFs, "rename");

			await memFs.writeFile("/repo/lib/B.luau", "");
			await settle();

			expect(rename.mock.calls.map(([, to]) => to)).toEqual([
				"/repo/lobby.project.json",
			]);
		});

		it("should not rewrite a project file whose bytes would not change", async () => {
			await run();
			const rename = jest.spyOn(memFs, "rename");
			const readFile = jest.spyOn(memFs, "readFile");

			await write(
				"/repo/default.rogen.json",
				config({ tags: { mock: false } })
			);
			await settle();

			expect(readFile).toHaveBeenCalledWith("/repo/default.project.json");
			expect(rename).not.toHaveBeenCalled();
		});

		it("should rebuild one config while another is still writing", async () => {
			await write("/repo/source.rogen.json", config());
			await run(["default", "source"]);
			const gate = new DeferredPromise<void>();
			const writeFile = memFs.writeFile.bind(memFs);
			jest.spyOn(memFs, "writeFile").mockImplementation(
				async (file, content) => {
					if (file === "/repo/default.project.json.tmp") await gate.p;
					return writeFile(file, content);
				}
			);

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built("source")).toEqual(["A"]);
			expect(await built("default")).toEqual([]);

			gate.complete();
			await settle();

			expect(await built("default")).toEqual(["A"]);
		});

		it("should not overlap two rebuilds of one config", async () => {
			await run();
			const gate = new DeferredPromise<void>();
			const writeFile = memFs.writeFile.bind(memFs);
			const staged = jest.fn();
			jest.spyOn(memFs, "writeFile").mockImplementation(
				async (file, content) => {
					if (file === "/repo/default.project.json.tmp") {
						staged();
						await gate.p;
					}
					return writeFile(file, content);
				}
			);

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(staged).toHaveBeenCalledTimes(1);

			gate.complete();
			await settle();

			expect(staged).toHaveBeenCalledTimes(2);
			expect(await built("default")).toEqual(["A", "B"]);
		});
	});

	describe("hot reload", () => {
		it("should reload when a config changes", async () => {
			await run();
			const reload = jest.spyOn(configService, "reload");

			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["src"], exclude: [] })
			);
			await settle();

			expect(reload).toHaveBeenCalledWith(["/repo/default.rogen.json"]);
		});

		it("should reload when a template changes", async () => {
			await write("/repo/template.project.json", {
				name: "one",
				tree: {},
			});
			await write(
				"/repo/default.rogen.json",
				config({ template: "template.project.json" })
			);
			await run();
			const reload = jest.spyOn(configService, "reload");

			await write("/repo/template.project.json", {
				name: "two",
				tree: {},
			});
			await settle();

			expect(reload).toHaveBeenCalledWith([
				"/repo/template.project.json",
			]);
			expect(
				JSON.parse(await memFs.readFile("/repo/default.project.json"))
					.name
			).toBe("two");
		});

		it("should not reload when an unrelated config changes", async () => {
			await write("/repo/other.rogen.json", config());
			await run();
			const reload = jest.spyOn(configService, "reload");

			await write("/repo/other.rogen.json", config({ exclude: ["x"] }));
			await settle();

			expect(reload).not.toHaveBeenCalled();
		});

		it("should reload every config that extends an edited parent", async () => {
			await write("/repo/base.rogen.json", config());
			await write("/repo/default.rogen.json", {
				extends: "base.rogen.json",
			});
			await write("/repo/source.rogen.json", {
				extends: "base.rogen.json",
				outFile: "source.project.json",
			});
			await memFs.createDirectory("/repo/lib");
			await memFs.writeFile("/repo/lib/L.luau", "");
			await run(["default", "source"]);

			await write("/repo/base.rogen.json", config({ rootDirs: ["lib"] }));
			await settle();

			expect(await built("default")).toEqual(["L"]);
			expect(await built("source")).toEqual(["L"]);
		});

		it("should watch again when a reload adds a root", async () => {
			await memFs.createDirectory("/repo/lib");
			await run();
			const watch = jest.spyOn(watcher, "watch");

			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await settle();
			await memFs.writeFile("/repo/lib/L.luau", "");
			await settle();

			expect(watch).toHaveBeenCalledTimes(1);
			expect(await built("default")).toEqual(["L"]);
		});

		it("should pick up a config edited while the watcher restarted", async () => {
			await memFs.createDirectory("/repo/lib");
			await memFs.createDirectory("/repo/lib2");
			await memFs.writeFile("/repo/lib2/L2.luau", "");
			await run();
			const watch = watcher.watch.bind(watcher);
			jest.spyOn(watcher, "watch").mockImplementationOnce(
				async (requests, options) => {
					await write(
						"/repo/default.rogen.json",
						config({ rootDirs: ["lib2"] })
					);
					return watch(requests, options);
				}
			);

			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await settle();

			expect(await built("default")).toEqual(["L2"]);
		});

		it("should keep building from the last valid config when one goes invalid", async () => {
			await write("/repo/prod.rogen.json", config());
			await run(["default", "prod"]);

			await write("/repo/prod.rogen.json", "{ broken");
			await settle();
			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built("default")).toEqual(["A"]);
			expect(await built("prod")).toEqual(["A"]);
		});

		it("should print an invalid config once", async () => {
			await write("/repo/prod.rogen.json", config());
			await run(["default", "prod"]);
			const error = jest.spyOn(logService, "error");

			await write("/repo/prod.rogen.json", "{ broken");
			await settle();
			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(error).toHaveBeenCalledTimes(1);
		});

		it("should build from a config again once it is valid", async () => {
			await run();
			await write("/repo/default.rogen.json", "{ broken");
			await settle();

			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await memFs.createDirectory("/repo/lib");
			await memFs.writeFile("/repo/lib/L.luau", "");
			await settle();

			expect(await built("default")).toEqual(["L"]);
		});
	});

	describe("warnings", () => {
		it("should print a warning once, not on every rebuild", async () => {
			await write(
				"/repo/default.rogen.json",
				config({ routes: { server: "ServerScriptService" } })
			);
			await memFs.writeFile("/repo/src/A.luau", "");
			const warn = jest.spyOn(logService, "warn");
			await run();

			await memFs.writeFile("/repo/src/B.server.luau", "");
			await settle();
			await memFs.writeFile("/repo/src/C.server.luau", "");
			await settle();

			expect(warn).toHaveBeenCalledTimes(1);
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
			const queueEvents = jest.spyOn(reconciliation, "queueEvents");

			await memFs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(queueEvents).not.toHaveBeenCalled();
		});

		it("should return an error and stop the watcher when watching fails", async () => {
			jest.spyOn(watcher, "watch").mockRejectedValue(new Error("boom"));
			const stop = jest.spyOn(watcher, "stop");

			const result = await startWatch();

			expect(result.isErr()).toBe(true);
			expect(stop).toHaveBeenCalled();
		});

		it("should leave no subscription behind when watching fails", async () => {
			jest.spyOn(watcher, "watch").mockRejectedValue(new Error("boom"));
			await startWatch();
			const rename = jest.spyOn(memFs, "rename");

			reconciliation.queueEvents([
				{
					type: FileChangeType.ADDED,
					path: "/repo/src/A.luau",
					fileType: FileType.File,
				},
			]);
			await settle();

			expect(rename).not.toHaveBeenCalled();
		});
	});
});
