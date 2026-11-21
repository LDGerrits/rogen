import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { WriteRun } from "../write/write.js";

export interface SyncbackRequest {
	readonly selection: ConfigSelection;
	readonly project: ResolvedConfig;
	readonly input: string;
	readonly cwd: string;
}

export interface SyncbackChange {
	readonly kind: "write" | "remove";
	readonly file: string;
}

export interface UnplacedInstance {
	readonly instance: string;
	readonly reason: string;
}

export interface SyncbackPlan {
	readonly project: ResolvedConfig;
	readonly changes: readonly SyncbackChange[];
	readonly listed: readonly SyncbackChange[];
	readonly unplaced: readonly UnplacedInstance[];
	readonly compiled: readonly CompiledChange[];
}

export interface SyncbackResult extends SyncbackPlan {
	readonly warnings: readonly Diagnostic[];
}

export type SyncbackMode =
	| "dryRun"
	| "apply"
	| { readonly confirm: (plan: SyncbackPlan) => Promise<boolean> };

export interface SyncbackOptions {
	readonly input: string;
	readonly cwd: string;
	readonly mode: SyncbackMode;
}

export type SyncbackOutcome =
	| { readonly kind: "notRun" }
	| {
			readonly kind: "failed";
			readonly error: Error;
			readonly configFile: string;
	  }
	| {
			readonly kind: "planned" | "declined" | "written";
			readonly plan: SyncbackPlan;
			readonly warnings: readonly Diagnostic[];
			readonly asked: boolean;
	  };

export interface SyncbackRun {
	readonly write: WriteRun;
	readonly outcome: SyncbackOutcome;
}

const PLACE_FILE = /\.rbxlx?$|\.rbxmx?$/i;

export function placeFileAmong(names: readonly string[]): string | undefined {
	return names.find((name) => PLACE_FILE.test(name));
}

export interface CompiledChange {
	readonly instance: string;
	readonly kind: "changed" | "removed" | "added";
}
