import { createDecorator } from "../instantiation/instantiation.js";

export interface InputService {
	readonly _serviceBrand: undefined;

	readonly isTerminal: boolean;

	readAll(): Promise<string>;
}

export const InputService = createDecorator<InputService>("inputService");
