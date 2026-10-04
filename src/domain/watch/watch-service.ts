import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { FileChange } from "../../platform/fs/file-changes.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ConfigBuild } from "../build/build-service.js";
import { ConfigNotice, ConfigSelection } from "../config/config-service.js";

/** Why the configs were rebuilt. */
export type WatchCause =
	| { readonly kind: "initial" }
	/** Too many changes at once to follow, so everything was rebuilt. */
	| { readonly kind: "burst" }
	| {
			readonly kind: "change";
			readonly sourceFiles: number;
			/** The config files that changed, as absolute paths. */
			readonly configFiles: readonly string[];
			readonly reloaded: boolean;
	  };

/** What the run did for one config in a round; `config` is the version that was built. */
export type RebuildReport = ConfigBuild & {
	/** Whether this round checked the sync dir; `syncWarnings` is empty when it didn't. */
	readonly checkedSyncDir: boolean;
};

/** One round of rebuilds, fired once every rebuild in it has finished. */
export interface WatchUpdate {
	readonly at: Date;
	readonly cause: WatchCause;
	/** The source changes behind it. */
	readonly changes: readonly FileChange[];
	/** The configs whose latest reload found errors not reported before; the last valid version of each is still what builds. */
	readonly notices: readonly ConfigNotice[];
	readonly reports: readonly RebuildReport[];
}

/** A running watch; the caller owns it and disposes it. */
export interface WatchSession extends Disposable {
	/** Fired once per round of rebuilds. */
	readonly onDidUpdate: Event<WatchUpdate>;
	/** A step failed unexpectedly; the watch goes on. */
	readonly onDidError: Event<Error>;

	/** Resolves once the watcher is live and the initial build is queued, so no change goes unseen. */
	start(): Promise<void>;
	/** Lets the work already started finish, then stops the watcher. Safe to call twice. */
	stop(): Promise<void>;
}

/** Watches a selection's configs and rebuilds them as their sources and files change. */
export interface WatchService {
	readonly _serviceBrand: undefined;

	/** The session reloads `selection` as its files change. The caller owns the session: it starts it, stops it and disposes it. */
	watch(selection: ConfigSelection): WatchSession;
}

export const WatchService =
	createServiceIdentifier<WatchService>("watchService");
