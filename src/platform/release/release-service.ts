import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface ReleaseService {
	readonly _serviceBrand: undefined;

	/** Released versions as of the last check, prereleases included; none before a check finishes. Starts a check when the last is a day old. */
	published(): Promise<readonly string[]>;

	/** Whether to announce `version` now, not when announced within a day. Answering yes counts as announcing. */
	announce(version: string): Promise<boolean>;
}

export const ReleaseService =
	createServiceIdentifier<ReleaseService>("releaseService");
