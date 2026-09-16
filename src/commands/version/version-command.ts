import { Command } from "../command.js";
import { LogService } from "../../platform/log/log-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { getVersion } from "./get-version.js";
import { Result, ok } from "../../base/result.js";

export class VersionCommand implements Command {
	constructor(
		private readonly logService: LogService,
		private readonly fileSystemService: FileSystemService
	) {}

	async execute(): Promise<Result<void, Error>> {
		const version = await getVersion(
			this.fileSystemService,
			import.meta.dirname
		);
		this.logService.info(`rogen ${version}`);

		return ok(undefined);
	}
}
