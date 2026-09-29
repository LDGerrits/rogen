import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { WatchSession } from "./watch-session.js";

/** Watches the loaded configs and rebuilds them as their sources change. */
export interface WatchService {
	readonly _serviceBrand: undefined;

	/** The caller owns the session: it starts it, stops it and disposes it. */
	watch(): WatchSession;
}

export const WatchService =
	createServiceIdentifier<WatchService>("watchService");
