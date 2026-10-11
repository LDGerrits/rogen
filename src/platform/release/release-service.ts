import { createServiceIdentifier } from "../instantiation/instantiation.js";

/** What has been published of Rogen, as the last check found it. */
export interface ReleaseService {
	readonly _serviceBrand: undefined;

	/** The versions released, prereleases included and in no order, as of the last check; none until a check has finished. Starts a new check beside the caller when the last one is a day old, so the answer never waits for the network. */
	published(): Promise<readonly string[]>;

	/** Whether to tell the user about `version` now, which is not when they were told within a day. Answering yes counts as telling them. */
	announce(version: string): Promise<boolean>;
}

export const ReleaseService =
	createServiceIdentifier<ReleaseService>("releaseService");
