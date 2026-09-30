import { Result, ok } from "../../base/result.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { ProductService } from "../../platform/product/product-service.js";

registerCommand(
	class VersionCommand extends AbstractCommand {
		constructor() {
			super({
				id: "version",
				metadata: { description: "Prints the installed version." },
			});
		}

		async run(accessor: ServicesAccessor): Promise<Result<void, Error>> {
			const version = await accessor.get(ProductService).getVersion();
			accessor.get(LogService).print(`rogen ${version}`);
			return ok(undefined);
		}
	}
);
