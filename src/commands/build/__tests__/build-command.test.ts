import { jest } from "@jest/globals";
import "../build-command.js";
import { ResultError } from "../../../base/result.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import {
	MockConfigService,
	mockEntry,
} from "../../../domain/config/__tests__/mock-config-service.js";
import { ConfigService } from "../../../domain/config/config-service.js";
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

	const run = (configService: MockConfigService, logService: LogService) => {
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(ConfigService, configService);
		return store
			.add(new CoreCommandService(services, logService))
			.executeCommand("build", { _: ["build"] });
	};

	it("should read its root dirs from the ConfigService", async () => {
		const logService = new NullLogService();
		const info = jest.spyOn(logService, "info");
		const result = await run(
			new MockConfigService([
				mockEntry({ rootDirs: ["core", "lobby"] }),
			]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(info).toHaveBeenCalledWith("Building. Root dirs: core, lobby");
	});

	it("should refuse to build when a config is invalid", async () => {
		const logService = new NullLogService();
		const entry = {
			...mockEntry(),
			diagnostics: [
				errorDiagnostic(
					"config.unknownField",
					{ resource: "/repo/default.rogen.json" },
					"boom."
				),
			],
		};

		const result = await run(new MockConfigService([entry]), logService);

		expect((result as ResultError<Error>).error.message).toBe(
			"/repo/default.rogen.json - error: boom."
		);
	});
});
