import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileChange } from "../../platform/fs/file-changes.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { LoadedConfig } from "../write/write.js";
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
	/** Files in a compiled path changed, so only its check ran again. */
	| { readonly kind: "compiled"; readonly files: number }
	| {
			readonly kind: "change";
			readonly sourceFiles: number;
			/** The config files that changed, as absolute paths. */
			readonly configFiles: readonly string[];
			readonly reloaded: boolean;
	  };

/** One config's rewrite in a round, with what it says that the previous rewrite didn't. */
export interface RewriteReport {
	/** `outcome.config` is the version that was written. */
	readonly outcome: LoadedConfig;
	/** The diagnostics of `outcome` its previous rewrite didn't have, in print order. */
	readonly unreported: readonly Diagnostic[];
	/** The diagnostics of `outcome` that the previous rewrite had too. */
	readonly repeated: readonly Diagnostic[];
	/** The diagnostics of the previous rewrite that `outcome` no longer has. */
	readonly fixed: readonly Diagnostic[];
	/** It failed with the same errors as the previous rewrite. */
	readonly repeatedFailure: boolean;
}

/** One round of rewrites, fired once every rewrite in it has finished. */
export interface WatchUpdate {
	readonly at: Date;
	readonly cause: WatchCause;
	readonly changes: readonly FileChange[];
	/** What the config reloads of this round said: added, removed, broken or loading again. */
	readonly notices: readonly ConfigNotice[];
	readonly reports: readonly RewriteReport[];
}

/** What a watch is for, when the files are not all it serves. */
export interface WatchOptions {
	/** A step reads the files themselves after each round, so an edit inside a file or a change to the compiled path counts: a change to one of `ignoring`, which the step writes, does not. */
	readonly contentEdits?: { readonly ignoring: readonly string[] };
}

/** A running watch; the caller owns it and disposes it. */
export interface WatchSession extends Disposable {
	/** The configs it writes now. */
	readonly configs: readonly ResolvedConfig[];
	/** Fired once per round of rewrites. */
	readonly onDidUpdate: Event<WatchUpdate>;
	/** A step failed unexpectedly; the watch goes on. */
	readonly onDidError: Event<Error>;

	/** Resolves once the watcher is live and the initial write is queued, so no change goes unseen. */
	start(): Promise<Result<void, Error>>;
	/** Lists the source paths again and rewrites every config from them, without waiting for the watcher to report what changed; reports nothing. */
	refresh(): Promise<void>;
	/** Lets the work already started finish, then stops the watcher. Safe to call twice. */
	stop(): Promise<void>;
}

export interface WatchService {
	readonly _serviceBrand: undefined;

	/** Fails as a write would when a config is broken or the configs can't be written together. The caller starts, stops and disposes the session; one at a time, as sessions share the process's watcher. */
	watch(
		selection: ReloadableSelection,
		options?: WatchOptions
	): Result<WatchSession, DiagnosticsError>;
}

export const WatchService =
	createServiceIdentifier<WatchService>("watchService");
