import { Command } from "../command.js";
import { LogService } from "../../platform/log/log-service.js";
import { getVersion } from "../../platform/cli/version.js";
import { Result, ok } from "../../base/result.js";

export class VersionCommand implements Command {
	constructor(private readonly logService: LogService) {}

	execute(): Result<void, Error> {
		const version = getVersion();
		this.logService.info(`rogen ${version}`);

		return ok(undefined);
	}
}
