import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";

export interface SyncbackRequest {
	readonly selection: ConfigSelection;
	/** The project whose files take the changes; its project file is written. */
	readonly project: ResolvedConfig;
	/** The place or model file Rojo reads, as given. */
	readonly input: string;
	/** Where Rojo runs, so `input` is relative to it. */
	readonly cwd: string;
}

/** A file or folder syncback writes or removes. */
export interface SyncbackChange {
	readonly kind: "write" | "remove";
	/** Absolute, in the system's own form. */
	readonly file: string;
}

/** An instance of the place that no folder of the project can take, which syncback leaves out and says so. */
export interface UnplacedInstance {
	readonly instance: string;
	readonly reason: string;
}

export interface SyncbackPlan {
	readonly project: ResolvedConfig;
	/** What a run would write and remove, the new files at the place routing puts them. */
	readonly changes: readonly SyncbackChange[];
	readonly unplaced: readonly UnplacedInstance[];
}

export interface SyncbackResult extends SyncbackPlan {
	/** What a build raises about the files syncback placed: one that lands elsewhere than the place had it. */
	readonly warnings: readonly Diagnostic[];
}
