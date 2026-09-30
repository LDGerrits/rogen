import { jest } from "@jest/globals";
import "../version-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { LogService } from "../../../platform/log/log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockProductService } from "../../../platform/product/__tests__/mock-product-service.js";
import { ProductService } from "../../../platform/product/product-service.js";

describe("version command", () => {
	let store: DisposableStore;
	let logService: NullLogService;
	let services: ServiceCollection;

	const run = () =>
		store
			.add(new CoreCommandService(services, logService))
			.executeCommand("version", { _: ["version"] });

	beforeEach(() => {
		store = new DisposableStore();
		logService = new NullLogService();
		services = new ServiceCollection();
		services.set(LogService, logService);
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should print the installed version", async () => {
		services.set(ProductService, new MockProductService("9.9.9"));
		const print = jest.spyOn(logService, "print");

		const result = await run();

		expect(result.isOk()).toBe(true);
		expect(print).toHaveBeenCalledWith("rogen 9.9.9");
	});
});
