import os from "os";
import { Event } from "../../base/event.js";
import { createDecorator } from "../instantiation/instantiation.js";

export interface LifecycleService {
	readonly _serviceBrand: undefined;

	readonly onWillShutdown: Event<void>;

	readonly signal: NodeJS.Signals | undefined;
}

export const LifecycleService =
	createDecorator<LifecycleService>("lifecycleService");

export function exitCodeOfSignal(signal: NodeJS.Signals): number {
	return 128 + (os.constants.signals[signal] ?? 0);
}
