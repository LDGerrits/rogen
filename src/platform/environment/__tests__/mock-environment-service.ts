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
		public readonly tmpDir: string = "/mock/tmp"
	) {
		this.isPlain = !isInteractive;
	}
}
