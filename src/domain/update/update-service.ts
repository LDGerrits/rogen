import { createDecorator } from "../../platform/instantiation/instantiation.js";

export interface UpdateService {
	readonly _serviceBrand: undefined;

	/** The notice to print, or `undefined`. Answers from the last check without waiting for the network, and starts the next check. */
	check(): Promise<string | undefined>;
}

export const UpdateService = createDecorator<UpdateService>("updateService");
