import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { RogenConfig } from "../config/config.js";

export interface PlannedMove {
	readonly from: string;
	readonly to: string;
	readonly reason?: string;
}

export interface MigratedConfig {
	readonly fileName: string;
	readonly config: RogenConfig;
}

export interface MigratedProject {
	readonly label: string;
	readonly from: readonly string[];
	readonly configs: readonly MigratedConfig[];
	readonly moves: readonly PlannedMove[];
	readonly notes: readonly string[];
	readonly warnings: readonly Diagnostic[];
	readonly edits: readonly string[];
}

export interface ProjectMigration {
	find(
		folder: string,
		files: FileReader
	): Promise<Result<MigratedProject | undefined, Diagnostic[]>>;
}
