import { UsageError } from "../../base/errors.js";
import { Result } from "../../base/result.js";
import { ConfigSelection } from "../../domain/config/config-service.js";
import { ResolvedConfig } from "../../domain/config/resolved-config.js";
import { RojoTarget } from "./rojo-entry.js";

export interface RojoPlan {
	readonly project: ResolvedConfig;
	readonly flags: readonly string[];
	readonly cwd: string;
}

export interface RojoStep {
	readonly command: RojoTarget["command"];
	readonly prints: boolean;
	readonly target: RojoTarget;
	plan(selection: ConfigSelection): Result<RojoPlan | undefined, UsageError>;
}
