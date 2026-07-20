import { getVersion } from "../platform/cli/version.js";
import { LogService } from "../platform/log/log-service.js";

export function runVersionCommand(logService: LogService): void {
	const version = getVersion();
	logService.info(`rogen ${version}`);
}
