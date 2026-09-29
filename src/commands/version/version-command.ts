import { ok } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { ProductService } from "../../platform/product/product-service.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "version",
	metadata: { description: "Prints the installed version." },
	handler: async (accessor) => {
		const version = await accessor.get(ProductService).getVersion();
		accessor.get(LogService).print(`rogen ${version}`);

		return ok(undefined);
	},
});
