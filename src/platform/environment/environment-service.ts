import { createDecorator } from "../instantiation/instantiation.js";
import { LogLevel } from "../log/log-service.js";

export interface EnvironmentService {
	readonly _serviceBrand: undefined;

	readonly cwd: string;
	readonly userHome: string;
	readonly tmpDir: string;
	readonly cacheDir: string;
	readonly annotationsIn?: string;
	readonly isWindows: boolean;
	readonly pid: number;

	readVariable(name: string): string | undefined;

	readonly logLevel: LogLevel;
	readonly isCi: boolean;
	readonly isInteractive: boolean;
	readonly isPlain: boolean;
	readonly hasColor: boolean;
}

export const EnvironmentService =
	createDecorator<EnvironmentService>("environmentService");
