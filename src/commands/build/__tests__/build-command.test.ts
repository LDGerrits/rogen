import { BuildCommand } from "../build-command.js";
import { NullLogService } from "../../../platform/log/log-service.js";
import { MockConfigService } from "../../../platform/config/__tests__/mock-config-service.js";

describe("BuildCommand", () => {
	it("constructs against the ConfigService interface, not a concrete implementation", () => {
		const configService = new MockConfigService({ rootDirs: ["src"] });

		expect(
			() => new BuildCommand(new NullLogService(), configService)
		).not.toThrow();
	});

	it("reads its config through the injected ConfigService double", async () => {
		const configService = new MockConfigService({
			rootDirs: ["core", "lobby"],
		});
		const command = new BuildCommand(new NullLogService(), configService);

		const result = await command.execute({ _: [] });

		expect(result.isOk()).toBe(true);
	});
});
