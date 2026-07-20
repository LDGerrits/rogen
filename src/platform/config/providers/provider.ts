import { Result } from "../../../base/result.js";
import { UserConfig } from "../config.js";

export interface WorkspaceContext {
	cwd: string;
	configPath?: string;
}

export interface IConfigProvider {
	readonly name: string;
	read(ctx: WorkspaceContext): Promise<Result<UserConfig, Error>>;
}
