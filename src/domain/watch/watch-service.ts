import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileChange } from "../../platform/fs/file-changes.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { LoadedBuild } from "../build/build.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ConfigNotice, ReloadableSelection } from "../config/config-service.js";

/** Changes that came too fast to follow, so they were dropped. */
export interface ChangeBurst {
	readonly dropped: number;
	readonly threshold: number;
	/** Whether the burst has stopped, so `dropped` counts the changes since the first report. */
	readonly ended: boolean;
}

export type WatchCause =
	| { readonly kind: "initial" }
	| ({ readonly kind: "burst" } & ChangeBurst)
	| {
			readonly kind: "change";
			readonly sourceFiles: number;
			/** The config files that changed, as absolute paths. */
			readonly configFiles: readonly string[];
			readonly reloaded: boolean;
	  };

/** One config's rebuild in a round, with what it says that the previous rebuild didn't. */
export interface RebuildReport {
	/** `build.config` is the version that was built. */
	readonly build: LoadedBuild;
	/** The diagnostics of `build` its previous rebuild didn't have, in print order. */
	readonly unreported: readonly Diagnostic[];
	/** The diagnostics of `build` that the previous rebuild had too. */
	readonly repeated: readonly Diagnostic[];
	/** The diagnostics of the previous rebuild that `build` no longer has. */
	readonly fixed: readonly Diagnostic[];
	/** It failed with the same errors as the previous rebuild. */
	readonly repeatedFailure: boolean;
}

/** One round of rebuilds, fired once every rebuild in it has finished. */
export interface WatchUpdate {
	readonly at: Date;
	readonly cause: WatchCause;
	readonly changes: readonly FileChange[];
	/** What the config reloads of this round said: added, removed, broken or loading again. */
	readonly notices: readonly ConfigNotice[];
	readonly reports: readonly RebuildReport[];
}

/** A running watch; the caller owns it and disposes it. */
export interface WatchSession extends Disposable {
	/** The configs it builds now. */
	readonly configs: readonly ResolvedConfig[];
	/** Fired once per round of rebuilds. */
	readonly onDidUpdate: Event<WatchUpdate>;
	/** A step failed unexpectedly; the watch goes on. */
	readonly onDidError: Event<Error>;

	/** Resolves once the watcher is live and the initial build is queued, so no change goes unseen. */
	start(): Promise<Result<void, Error>>;
	/** Lets the work already started finish, then stops the watcher. Safe to call twice. */
	stop(): Promise<void>;
}

export interface WatchService {
	readonly _serviceBrand: undefined;

	/** Fails as a build would when a config is broken or the configs can't be built together. The caller starts, stops and disposes the session; one at a time, as sessions share the process's watcher. */
	watch(
		selection: ReloadableSelection
	): Result<WatchSession, DiagnosticsError>;
}

export const WatchService =
	createServiceIdentifier<WatchService>("watchService");
