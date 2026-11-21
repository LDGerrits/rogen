import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileChange } from "../../platform/fs/file-changes.js";
import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { LoadedConfig } from "../write/write.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ConfigNotice, ReloadableSelection } from "../config/config-service.js";

export interface ChangeBurst {
	readonly dropped: number;
	readonly threshold: number;
	readonly ended: boolean;
}

export type WatchCause =
	| { readonly kind: "initial" }
	| { readonly kind: "refresh" }
	| ({ readonly kind: "burst" } & ChangeBurst)
	| { readonly kind: "compiled"; readonly files: number }
	| {
			readonly kind: "change";
			readonly sourceFiles: number;
			readonly configFiles: readonly string[];
			readonly reloaded: boolean;
	  };

export interface RewriteReport {
	readonly outcome: LoadedConfig;
	readonly unreported: readonly Diagnostic[];
	readonly repeated: readonly Diagnostic[];
	readonly fixed: readonly Diagnostic[];
	readonly repeatedFailure: boolean;
}

export interface WatchUpdate {
	readonly at: Date;
	readonly cause: WatchCause;
	readonly changes: readonly FileChange[];
	readonly notices: readonly ConfigNotice[];
	readonly reports: readonly RewriteReport[];
}

export interface WatchSession extends Disposable {
	readonly configs: readonly ResolvedConfig[];
	readonly onDidUpdate: Event<WatchUpdate>;
	readonly onDidError: Event<Error>;

	start(): Promise<Result<void, Error>>;
	refresh(): Promise<void>;
	stop(): Promise<void>;
}

export interface WatchService {
	readonly _serviceBrand: undefined;

	watch(
		selection: ReloadableSelection
	): Result<WatchSession, DiagnosticsError>;
}

export const WatchService = createDecorator<WatchService>("watchService");
