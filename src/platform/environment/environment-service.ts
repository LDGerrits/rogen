import { createServiceIdentifier } from "../instantiation/instantiation.js";
import { LogLevel } from "../log/log-service.js";

export interface EnvironmentService {
	readonly _serviceBrand: undefined;

	readonly cwd: string;

	/** How much to print: errors only under `--quiet`, debug output under `--verbose`. */
	readonly logLevel: LogLevel;
	/** Whether a person can answer a question: stdin and stdout are terminals, the terminal isn't dumb, and no agent or CI runs the process. */
	readonly isInteractive: boolean;
	/** Whether to print plain lines instead of drawing: the run prints JSON or isn't interactive, or `NO_COLOR` is set. */
	readonly isPlain: boolean;
}

export const EnvironmentService =
	createServiceIdentifier<EnvironmentService>("environmentService");
