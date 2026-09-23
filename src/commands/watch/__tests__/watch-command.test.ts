import { jest } from "@jest/globals";
import "../watch-command.js";
import { DeferredPromise } from "../../../base/async.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { MockConfigService } from "../../../platform/config/__tests__/mock-config-service.js";
import { ConfigService } from "../../../platform/config/config.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";
import { CoreReconciliationService } from "../../../platform/watcher/core-reconciliation-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { ReconciliationService } from "../../../platform/watcher/reconciliation-service.js";
import { Watcher } from "../../../platform/watcher/watcher.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { LifecycleService } from "../../../platform/lifecycle/lifecycle-service.js";

describe("watch command", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let reconciliation: CoreReconciliationService;
	let store: DisposableStore;
	let lifecycle: MockLifecycleService;
	const logService = new NullLogService();

	const startWatch = (configService: MockConfigService) => {
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(Watcher, watcher);
		services.set(ReconciliationService, reconciliation);
		services.set(ConfigService, configService);
		services.set(LifecycleService, lifecycle);
		services.set(
			EnvironmentService,
			new MockEnvironmentService(undefined, "/repo")
		);

		return store
			.add(new CoreCommandService(services, logService))
			.executeCommand("watch", { _: ["watch"] });
	};

	beforeEach(async () => {
		jest.useFakeTimers();
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo");
		watcher = new MemoryWatcher(memFs, logService);
		store = new DisposableStore();
		lifecycle = new MockLifecycleService();
		reconciliation = new CoreReconciliationService(logService, {
			burstThreshold: 200,
			debounceMs: 100,
		});
	});

	afterEach(async () => {
		lifecycle.shutdown();
		jest.restoreAllMocks();
		await watcher.stop();
		reconciliation[Symbol.dispose]();
		store[Symbol.dispose]();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("should watch the config file the service actually resolved, not a hardcoded .rogen.json", async () => {
		await memFs.writeFile("/repo/custom.rogen.json", "{}");

		const configService = new MockConfigService(
			{ rootDirs: [] },
			"/repo/custom.rogen.json"
		);
		const reloadSpy = jest.spyOn(configService, "reloadConfig");
		void startWatch(configService);
		await Promise.resolve();
		await Promise.resolve();

		await memFs.writeFile(
			"/repo/custom.rogen.json",
			'{"rootDirs":["src"]}'
		);
		jest.advanceTimersByTime(150);
		await Promise.resolve();
		await Promise.resolve();

		expect(reloadSpy).toHaveBeenCalledTimes(1);
	});

	it("should not reload when a file at a hardcoded .rogen.json path changes", async () => {
		await memFs.writeFile("/repo/custom.rogen.json", "{}");
		await memFs.writeFile("/repo/.rogen.json", "{}");

		const configService = new MockConfigService(
			{ rootDirs: [] },
			"/repo/custom.rogen.json"
		);
		const reloadSpy = jest.spyOn(configService, "reloadConfig");
		void startWatch(configService);
		await Promise.resolve();
		await Promise.resolve();

		await memFs.writeFile("/repo/.rogen.json", '{"rootDirs":["src"]}');
		jest.advanceTimersByTime(150);
		await Promise.resolve();
		await Promise.resolve();

		expect(reloadSpy).not.toHaveBeenCalled();
	});

	it("should resolve ok when shutdown is requested", async () => {
		const running = startWatch(new MockConfigService({ rootDirs: [] }));
		await Promise.resolve();
		await Promise.resolve();

		lifecycle.shutdown();

		expect((await running).isOk()).toBe(true);
	});

	it("should stop the watcher when shutdown is requested", async () => {
		const stop = jest.spyOn(watcher, "stop");
		const running = startWatch(new MockConfigService({ rootDirs: [] }));
		await Promise.resolve();
		await Promise.resolve();
		stop.mockClear();

		lifecycle.shutdown();
		await running;

		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("should not react to file changes after shutdown", async () => {
		await memFs.createDirectory("/repo/src");
		const debug = jest.spyOn(logService, "debug");
		const running = startWatch(
			new MockConfigService({ rootDirs: ["src"] })
		);
		await Promise.resolve();
		await Promise.resolve();
		lifecycle.shutdown();
		await running;
		debug.mockClear();

		await memFs.writeFile("/repo/src/a.luau", "");
		jest.advanceTimersByTime(150);
		await Promise.resolve();
		await Promise.resolve();

		expect(debug).not.toHaveBeenCalledWith(
			expect.stringContaining("incremental build")
		);
	});

	it("should react to file changes while running", async () => {
		await memFs.createDirectory("/repo/src");
		const debug = jest.spyOn(logService, "debug");
		void startWatch(new MockConfigService({ rootDirs: ["src"] }));
		await Promise.resolve();
		await Promise.resolve();

		await memFs.writeFile("/repo/src/a.luau", "");
		jest.advanceTimersByTime(150);
		await Promise.resolve();
		await Promise.resolve();

		expect(debug).toHaveBeenCalledWith(
			expect.stringContaining("incremental build")
		);
	});

	it("should return an error and stops the watcher when watching fails", async () => {
		jest.spyOn(watcher, "watch").mockRejectedValue(new Error("boom"));
		const stop = jest.spyOn(watcher, "stop");

		const result = await startWatch(
			new MockConfigService({ rootDirs: [] })
		);

		expect(result.isErr()).toBe(true);
		expect(stop).toHaveBeenCalled();
	});

	it("should run the initial build only once the watcher is ready", async () => {
		const ready = new DeferredPromise<void>();
		jest.spyOn(watcher, "watch").mockReturnValue(ready.p);
		const debug = jest.spyOn(logService, "debug");
		void startWatch(new MockConfigService({ rootDirs: [] }));
		await Promise.resolve();
		await Promise.resolve();

		expect(debug).not.toHaveBeenCalledWith(
			expect.stringContaining("full rebuild")
		);

		ready.complete();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(debug).toHaveBeenCalledWith(
			expect.stringContaining("full rebuild")
		);
	});

	it("should not throw when shutdown is requested twice", async () => {
		const running = startWatch(new MockConfigService({ rootDirs: [] }));
		await Promise.resolve();
		await Promise.resolve();

		lifecycle.shutdown();
		lifecycle.shutdown();

		expect((await running).isOk()).toBe(true);
	});

	it("should leave no listeners behind for a second run", async () => {
		await memFs.createDirectory("/repo/src");
		const debug = jest.spyOn(logService, "debug");
		const first = startWatch(new MockConfigService({ rootDirs: ["src"] }));
		await Promise.resolve();
		await Promise.resolve();
		lifecycle.shutdown();
		await first;

		lifecycle = new MockLifecycleService();
		void startWatch(new MockConfigService({ rootDirs: ["src"] }));
		await Promise.resolve();
		await Promise.resolve();
		debug.mockClear();

		await memFs.writeFile("/repo/src/a.luau", "");
		jest.advanceTimersByTime(150);
		await Promise.resolve();
		await Promise.resolve();

		const incremental = debug.mock.calls.filter(([message]) =>
			String(message).includes("incremental build")
		);
		expect(incremental).toHaveLength(1);
	});
});
