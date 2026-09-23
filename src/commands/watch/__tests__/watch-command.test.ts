import { jest } from "@jest/globals";
import { WatchCommand } from "../watch-command.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { ReconciliationService } from "../../../platform/watcher/reconciliation-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { NullLogService } from "../../../platform/log/log-service.js";
import { MockConfigService } from "../../../platform/config/__tests__/mock-config-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";

describe("WatchCommand", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let reconciliation: ReconciliationService;
	const logService = new NullLogService();

	beforeEach(async () => {
		jest.useFakeTimers();
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo");
		watcher = new MemoryWatcher(memFs, logService);
		reconciliation = new ReconciliationService(logService, {
			burstThreshold: 200,
			debounceMs: 100,
		});
	});

	afterEach(async () => {
		await watcher.stop();
		reconciliation[Symbol.dispose]();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("constructs against the ConfigService interface, not a concrete implementation", () => {
		const configService = new MockConfigService({ rootDirs: [] });
		const environment = new MockEnvironmentService(undefined, "/repo");

		expect(
			() =>
				new WatchCommand(
					logService,
					watcher,
					reconciliation,
					configService,
					environment
				)
		).not.toThrow();
	});

	it("watches the config file the service actually resolved, not a hardcoded .rogen.json", async () => {
		await memFs.writeFile("/repo/custom.rogen.json", "{}");

		const configService = new MockConfigService(
			{ rootDirs: [] },
			"/repo/custom.rogen.json"
		);
		const reloadSpy = jest.spyOn(configService, "reloadConfig");
		const environment = new MockEnvironmentService(undefined, "/repo");
		const command = new WatchCommand(
			logService,
			watcher,
			reconciliation,
			configService,
			environment
		);

		void command.execute({ _: [] });
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
		const environment = new MockEnvironmentService(undefined, "/repo");
		const command = new WatchCommand(
			logService,
			watcher,
			reconciliation,
			configService,
			environment
		);

		void command.execute({ _: [] });
		await Promise.resolve();
		await Promise.resolve();

		await memFs.writeFile("/repo/.rogen.json", '{"rootDirs":["src"]}');
		jest.advanceTimersByTime(150);
		await Promise.resolve();
		await Promise.resolve();

		expect(reloadSpy).not.toHaveBeenCalled();
	});
});
