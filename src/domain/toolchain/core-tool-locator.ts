import path from "path";
import { isWindows } from "../../base/platform.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { ToolLocator } from "./tool-locator.js";

export class CoreToolLocator implements ToolLocator {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ProcessService private readonly processService: ProcessService,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService
	) {}

	async find(command: string): Promise<string | undefined> {
		const onPath = await this.processService.which(command);
		if (onPath) return onPath;
		const file = path.join(
			this.environmentService.userHome,
			".rokit",
			"bin",
			isWindows && path.extname(command) === ""
				? `${command}.exe`
				: command
		);
		return (await this.fileSystemService.isFile(file)) ? file : undefined;
	}
}
