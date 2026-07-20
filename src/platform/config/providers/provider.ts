import { Result } from "../../../base/result.js";

export interface WorkspaceContext {
	cwd: string;
	configPath?: string;
}

export interface IConfigProvider {
	readonly name: string;
	read(
		ctx: WorkspaceContext
	): Promise<Result<Record<string, unknown>, Error>>;
}
