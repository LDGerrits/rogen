import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";

/** Tells the user when a newer Rogen is out. */
export interface UpdateService {
	readonly _serviceBrand: undefined;

	/** Starts the check and answers with the notice to print, or `undefined` when there is none. It answers from what the last check found, so it never waits for the network, and it starts the next check beside the command. Nothing at all for a run nobody reads at a terminal. */
	check(): Promise<string | undefined>;
}

export const UpdateService =
	createServiceIdentifier<UpdateService>("updateService");
