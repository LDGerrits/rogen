import path from "path";
import { isWindows } from "../../base/platform.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";

/** Finds a program on the PATH, then in Rokit's bin folder: the terminal that installed Rokit still has the PATH it started with, so what Rokit linked after that is not on it. */
export class ToolLocator {
	constructor(
		private readonly processService: ProcessService,
		private readonly files?: FileReader,
		private readonly userHome?: string
	) {}

	async find(command: string): Promise<string | undefined> {
		const onPath = await this.processService.which(command);
		if (onPath || !this.files || !this.userHome) return onPath;
		const file = path.join(
			this.userHome,
			".rokit",
			"bin",
			isWindows && path.extname(command) === ""
				? `${command}.exe`
				: command
		);
		return (await this.files.isFile(file)) ? file : undefined;
	}
}
