import { jest } from "@jest/globals";
import "../build-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { MockConfigService } from "../../../platform/config/__tests__/mock-config-service.js";
import { ConfigService } from "../../../platform/config/config.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";

describe("build command", () => {
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should read its root dirs from the ConfigService", async () => {
		const logService = new NullLogService();
		const info = jest.spyOn(logService, "info");
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(
			ConfigService,
			new MockConfigService({ rootDirs: ["core", "lobby"] })
		);
		const commandService = store.add(
			new CoreCommandService(services, logService)
		);

		const result = await commandService.executeCommand("build", {
			_: ["build"],
		});

		expect(result.isOk()).toBe(true);
		expect(info).toHaveBeenCalledWith("Building. Root dirs: core, lobby");
	});
});
