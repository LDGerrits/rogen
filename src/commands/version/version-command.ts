import { ok } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { getVersion } from "./get-version.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "version",
	metadata: { description: "Prints the installed version." },
	handler: async (accessor) => {
		const version = await getVersion(
			accessor.get(FileSystemService),
			import.meta.dirname
		);
		accessor.get(LogService).info(`rogen ${version}`);

		return ok(undefined);
	},
});
