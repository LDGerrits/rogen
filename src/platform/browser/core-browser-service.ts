import { ProcessService } from "../process/process-service.js";
import { BrowserService } from "./browser-service.js";

const TIMEOUT_MS = 10_000;

/** Opens a URL with the program the system uses for it. */
export class CoreBrowserService implements BrowserService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly processes: ProcessService,
		private readonly platform: NodeJS.Platform = process.platform
	) {}

	async open(url: string, cwd: string): Promise<boolean> {
		const [file, ...args] = this.launcher(url);
		if (this.platform !== "win32" && !(await this.processes.which(file)))
			return false;
		const result = await this.processes.exec(file, args, {
			cwd,
			timeout: TIMEOUT_MS,
		});
		return result.isOk() && result.value.code === 0;
	}

	private launcher(url: string): string[] {
		if (this.platform === "win32")
			return ["rundll32", "url.dll,FileProtocolHandler", url];
		return [this.platform === "darwin" ? "open" : "xdg-open", url];
	}
}
