import { jest } from "@jest/globals";
import "../watch-command.js";
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

describe("watch command", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let reconciliation: CoreReconciliationService;
	let store: DisposableStore;
	const logService = new NullLogService();

	const startWatch = (configService: MockConfigService) => {
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(Watcher, watcher);
		services.set(ReconciliationService, reconciliation);
		services.set(ConfigService, configService);
		services.set(
			EnvironmentService,
			new MockEnvironmentService(undefined, "/repo")
		);

		void store
			.add(new CoreCommandService(services, logService))
			.executeCommand("watch", { _: ["watch"] });
	};

	beforeEach(async () => {
		jest.useFakeTimers();
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo");
		watcher = new MemoryWatcher(memFs, logService);
		store = new DisposableStore();
		reconciliation = new CoreReconciliationService(logService, {
			burstThreshold: 200,
			debounceMs: 100,
		});
	});

	afterEach(async () => {
		await watcher.stop();
		reconciliation[Symbol.dispose]();
		store[Symbol.dispose]();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("watches the config file the service actually resolved, not a hardcoded .rogen.json", async () => {
		await memFs.writeFile("/repo/custom.rogen.json", "{}");

		const configService = new MockConfigService(
			{ rootDirs: [] },
			"/repo/custom.rogen.json"
		);
		const reloadSpy = jest.spyOn(configService, "reloadConfig");
		startWatch(configService);
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

	it("does not reload when a file at a hardcoded .rogen.json path changes", async () => {
		await memFs.writeFile("/repo/custom.rogen.json", "{}");
		await memFs.writeFile("/repo/.rogen.json", "{}");

		const configService = new MockConfigService(
			{ rootDirs: [] },
			"/repo/custom.rogen.json"
		);
		const reloadSpy = jest.spyOn(configService, "reloadConfig");
		startWatch(configService);
		await Promise.resolve();
		await Promise.resolve();

		await memFs.writeFile("/repo/.rogen.json", '{"rootDirs":["src"]}');
		jest.advanceTimersByTime(150);
		await Promise.resolve();
		await Promise.resolve();

		expect(reloadSpy).not.toHaveBeenCalled();
	});
});
