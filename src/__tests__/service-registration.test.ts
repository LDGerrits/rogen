import { Registry } from "../platform/registry/registry.js";
import { CommandRegistry, Extensions } from "../platform/commands/commands.js";
import { MockEnvironmentService } from "../platform/environment/__tests__/mock-environment-service.js";
import { CoreInstantiationService } from "../platform/instantiation/core-instantiation-service.js";
import { MockLogService } from "../platform/log/__tests__/mock-log-service.js";
import { registerServices } from "../main.js";

describe("the services main registers", () => {
	it("should each be built, with everything they ask for registered and no cycle", () => {
		const services = registerServices(
			new MockEnvironmentService("/repo"),
			new MockLogService(),
			Registry.as<CommandRegistry>(Extensions.Commands)
		);
		using instantiationService = new CoreInstantiationService(
			services,
			true
		);

		const ids = [...services.ids()];
		const built = instantiationService.invokeFunction((accessor) =>
			ids.map((id) => accessor.get(id))
		);

		expect(built.filter((service) => service === undefined)).toEqual([]);
		expect(built).toHaveLength(ids.length);
	});
});
