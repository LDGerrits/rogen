import { getVersion } from "../platform/cli/version.js";
import { ILogger } from "../platform/log/logger.js";

export function runVersionCommand(logger: ILogger): void {
	const version = getVersion();
	logger.info(`rogen ${version}`);
}
