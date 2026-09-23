import { jest } from "@jest/globals";
import "../help-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";

describe("help command", () => {
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should output the help instructions via the log service", async () => {
		const logService = new NullLogService();
		const info = jest.spyOn(logService, "info");
		const services = new ServiceCollection();
		services.set(LogService, logService);
		const commandService = store.add(
			new CoreCommandService(services, logService)
		);

		const result = await commandService.executeCommand("help", {
			_: ["help"],
		});

		expect(result.isOk()).toBe(true);
		expect(info).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith(expect.stringContaining("Rogen"));
	});
});
