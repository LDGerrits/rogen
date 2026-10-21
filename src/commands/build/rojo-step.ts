import { UsageError } from "../../base/errors.js";
import { Result } from "../../base/result.js";
import { ConfigSelection } from "../../domain/config/config-service.js";
import { ResolvedConfig } from "../../domain/config/resolved-config.js";
import { RojoTarget } from "./build-document.js";

/** One run of Rojo on one project. */
export interface RojoPlan {
	readonly project: ResolvedConfig;
	/** Rojo's flags, after the project file. */
	readonly flags: readonly string[];
	/** Where Rojo runs, so a path in `flags` is relative to it. */
	readonly cwd: string;
	/** What the run is for, as the JSON reports it. */
	readonly target: RojoTarget;
	/** Set when `flags` name no file, because Rojo's output is for the screen. */
	readonly printed?: true;
}

/** The Rojo command a command runs after it has written the project files. */
export interface RojoStep {
	readonly command: RojoTarget["command"];
	/** The run a selection asks for, or the reason it asks for none; none when its files are broken, which the build reports. */
	plan(selection: ConfigSelection): Result<RojoPlan | undefined, UsageError>;
}
