import os from "os";
import { ProcessService } from "../process/process-service.js";
import { BrowserService } from "./browser-service.js";

const TIMEOUT_MS = 10_000;

interface Launcher {
	readonly file: string;
	readonly args: readonly string[];
	/** Whether starting the program is enough, because it exits with 1 even after it opened the page. */
	readonly ignoresExitCode?: true;
}

/** Opens a URL with the program the system uses for it. */
export class CoreBrowserService implements BrowserService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly processes: ProcessService,
		private readonly platform: NodeJS.Platform = process.platform,
		private readonly release: string = os.release()
	) {}

	async open(url: string, cwd: string): Promise<boolean> {
		for (const { file, args, ignoresExitCode } of this.launchers(url)) {
			if (
				this.platform !== "win32" &&
				!(await this.processes.which(file))
			)
				continue;
			const result = await this.processes.exec(file, [...args], {
				cwd,
				timeout: TIMEOUT_MS,
			});
			if (result.isOk() && (ignoresExitCode || result.value.code === 0))
				return true;
		}
		return false;
	}

	private launchers(url: string): readonly Launcher[] {
		if (this.platform === "win32")
			return [
				{
					file: "rundll32",
					args: ["url.dll,FileProtocolHandler", url],
				},
			];
		if (this.platform === "darwin") return [{ file: "open", args: [url] }];
		if (/microsoft/i.test(this.release))
			return [
				{ file: "wslview", args: [url] },
				{ file: "explorer.exe", args: [url], ignoresExitCode: true },
			];
		return [{ file: "xdg-open", args: [url] }];
	}
}
