import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface InputService {
	readonly _serviceBrand: undefined;

	/** Everything this process's standard input holds, once it ends. */
	readAll(): Promise<string>;
}

export const InputService =
	createServiceIdentifier<InputService>("inputService");
