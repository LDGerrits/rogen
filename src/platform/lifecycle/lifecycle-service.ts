import os from "os";
import { Event } from "../../base/event.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface LifecycleService {
	readonly _serviceBrand: undefined;

	readonly onWillShutdown: Event<void>;

	/** The signal that asked for the shutdown, once one did; none when something else did, as a reader that quit. */
	readonly signal: NodeJS.Signals | undefined;
}

export const LifecycleService =
	createServiceIdentifier<LifecycleService>("lifecycleService");

/** What a shell reports for a process the signal stopped: 128 plus its number. */
export function exitCodeOfSignal(signal: NodeJS.Signals): number {
	return 128 + (os.constants.signals[signal] ?? 0);
}
