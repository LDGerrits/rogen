import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface EnvironmentService {
	readonly _serviceBrand: undefined;

	readonly cwd: string;

	readonly verbose: boolean;
	readonly quiet: boolean;

	/** Whether a person can answer a question: stdin and stdout are terminals, the terminal isn't dumb, and no agent or CI runs the process. */
	readonly isInteractive: boolean;
	/** Whether to print plain lines instead of drawing: the run isn't interactive, or `NO_COLOR` is set. */
	readonly isPlain: boolean;
}

export const EnvironmentService =
	createServiceIdentifier<EnvironmentService>("environmentService");
