import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { RogenConfig } from "../config/config.js";

/** A file `init` renames, relative to the folder it sets up. */
export interface PlannedMove {
	readonly from: string;
	readonly to: string;
}

/** A config a migration writes, named relative to the folder. */
export interface MigratedConfig {
	readonly fileName: string;
	readonly config: RogenConfig;
}

/** What a migration carries over from a project that another tool set up. */
export interface MigratedProject {
	/** What was found, as the summary names it, such as "a Rogen 1 config". */
	readonly label: string;
	/** The files it replaces, which `moves` set aside. */
	readonly from: readonly string[];
	readonly configs: readonly MigratedConfig[];
	readonly moves: readonly PlannedMove[];
	readonly notes: readonly string[];
	readonly warnings: readonly Diagnostic[];
	/** What the user does once it is written, after `rogen check`. */
	readonly edits: readonly string[];
}

/** Turns a project of another tool into `.rogen.json` files, which `init` writes in place of a new project. */
export interface ProjectMigration {
	/** `ok(undefined)` when `folder` holds nothing it carries over. */
	find(
		folder: string,
		files: FileReader
	): Promise<Result<MigratedProject | undefined, Diagnostic[]>>;
}
