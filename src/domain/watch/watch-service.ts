import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileChange } from "../../platform/fs/file-changes.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { LoadedBuild } from "../build/build.js";
import { ConfigNotice, ReloadableSelection } from "../config/config-service.js";

/** Why the configs were rebuilt. */
export type WatchCause =
	| { readonly kind: "initial" }
	/** Too many changes at once to follow, so they were dropped and everything was rebuilt. */
	| {
			readonly kind: "burst";
			readonly dropped: number;
			readonly threshold: number;
			/** The burst has stopped; `dropped` counts the changes after its first report. */
			readonly ended: boolean;
	  }
	| {
			readonly kind: "change";
			readonly sourceFiles: number;
			/** The config files that changed, as absolute paths. */
			readonly configFiles: readonly string[];
			readonly reloaded: boolean;
	  };

/** One config's rebuild in a round, with what it says that the config's previous rebuild didn't. */
export interface RebuildReport {
	/** `build.config` is the version that was built. */
	readonly build: LoadedBuild;
	/** The diagnostics of `build` its previous rebuild didn't have, in print order. */
	readonly unreported: readonly Diagnostic[];
	/** The diagnostics of `build` that the block leaves out because the previous rebuild had them too. */
	readonly repeated: readonly Diagnostic[];
	/** The diagnostics of the previous rebuild that `build` no longer has; one that only changed its text isn't fixed. */
	readonly fixed: readonly Diagnostic[];
	/** It failed with the same errors as the previous rebuild. */
	readonly repeatedFailure: boolean;
}

/** One round of rebuilds, fired once every rebuild in it has finished. */
export interface WatchUpdate {
	readonly at: Date;
	readonly cause: WatchCause;
	/** The source changes behind it. */
	readonly changes: readonly FileChange[];
	/** What the reloads of this round said about the configs: added, removed, broken (the last valid version of each still builds) or loading again. */
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
	start(): Promise<Result<void, Error>>;
	/** Lets the work already started finish, then stops the watcher. Safe to call twice. */
	stop(): Promise<void>;
}

/** Watches a selection's configs and rebuilds them as their sources and files change. */
export interface WatchService {
	readonly _serviceBrand: undefined;

	/** Fails as a build would when a config is broken or the configs can't be built together. The session reloads `selection` as its files change; the caller starts it, stops it and disposes it. One session at a time: they share the process's watcher. */
	watch(
		selection: ReloadableSelection
	): Result<WatchSession, DiagnosticsError>;
}

export const WatchService =
	createServiceIdentifier<WatchService>("watchService");
