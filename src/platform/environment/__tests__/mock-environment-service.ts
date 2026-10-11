import { LogLevel } from "../../log/log-service.js";
import { EnvironmentService } from "../environment-service.js";

export class MockEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	readonly isPlain: boolean;

	constructor(
		public readonly cwd: string = "/mock/cwd",
		public readonly logLevel: LogLevel = LogLevel.Info,
		public readonly isInteractive: boolean = false,
		public readonly userHome: string = "/mock/home",
		public readonly tmpDir: string = "/mock/tmp",
		public readonly pid: number = 4242,
		public readonly annotationsIn?: string,
		public readonly cacheDir: string = "/mock/cache",
		public readonly checksForUpdates: boolean = false
	) {
		this.isPlain = !isInteractive;
	}
}
