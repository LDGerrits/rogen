import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface InputService {
	readonly _serviceBrand: undefined;

	/** Whether a person types it, so nothing is piped in. */
	readonly isTerminal: boolean;

	/** Everything this process's standard input holds, once it ends. */
	readAll(): Promise<string>;
}

export const InputService =
	createServiceIdentifier<InputService>("inputService");
