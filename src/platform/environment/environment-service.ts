import { createServiceIdentifier } from "../instantiation/instantiation.js";
import { LogLevel } from "../log/log-service.js";

export interface EnvironmentService {
	readonly _serviceBrand: undefined;

	readonly cwd: string;
	readonly userHome: string;
	readonly tmpDir: string;
	/** `XDG_CACHE_HOME`, else the system's usual place for what a program can fetch again. */
	readonly cacheDir: string;
	/** Where the repository is checked out, set when this run should write GitHub Actions annotations. */
	readonly annotationsIn?: string;
	/** This process's id, so a serve's records in `tmpDir` can be told as its own. */
	readonly pid: number;

	readonly logLevel: LogLevel;
	/** Whether a person can answer a question: stdin and stdout are terminals, the terminal isn't dumb, and no agent or CI runs the process. */
	readonly isInteractive: boolean;
	/** Whether to print plain lines: JSON, not interactive, or `NO_COLOR`. */
	readonly isPlain: boolean;
	/** Whether to announce a newer Rogen: a person at a terminal, no JSON or `--quiet`, and no opt-out variable. */
	readonly checksForUpdates: boolean;
}

export const EnvironmentService =
	createServiceIdentifier<EnvironmentService>("environmentService");
