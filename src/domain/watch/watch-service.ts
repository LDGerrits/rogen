import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileChange } from "../../platform/fs/file-changes.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { BuildSummary } from "../build/build-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigEntry } from "../config/config-service.js";

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

/** The problems in a config's latest load, none when it loaded cleanly; with errors, the last valid version is still what builds. */
export interface ConfigNotice {
	readonly file: string;
	readonly errors: readonly Diagnostic[];
	readonly warnings: readonly Diagnostic[];
}

interface RebuildFields {
	readonly entry: ConfigEntry;
	/** The version of the config that was built. */
	readonly config: ResolvedConfig;
	/** The build's warnings, or why it failed. */
	readonly diagnostics: readonly Diagnostic[];
	/** What the sync dir check found; `undefined` when this round didn't check it. */
	readonly syncDiagnostics?: readonly Diagnostic[];
}

export type RebuildReport = RebuildFields &
	(
		| {
				readonly outcome: "wrote" | "unchanged";
				readonly summary: BuildSummary;
		  }
		| { readonly outcome: "failed"; readonly summary?: undefined }
	);

/** One round of rebuilds, fired once every rebuild in it has finished. */
export interface WatchUpdate {
	readonly at: Date;
	readonly cause: WatchCause;
	/** The source changes behind it. */
	readonly changes: readonly FileChange[];
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

/** Watches the loaded configs and rebuilds them as their sources change. */
export interface WatchService {
	readonly _serviceBrand: undefined;

	/** The caller owns the session: it starts it, stops it and disposes it. */
	watch(): WatchSession;
}

export const WatchService =
	createServiceIdentifier<WatchService>("watchService");
