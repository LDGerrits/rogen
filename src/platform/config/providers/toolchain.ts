import { ok, Result } from "../../../base/result.js";
import { ConfigProvider, WorkspaceContext } from "./provider.js";
import { WorkspaceService } from "../../workspace/workspace-service.js";

export class ToolchainProvider implements ConfigProvider {
	readonly name = "ToolchainProvider";

	constructor(private readonly workspaceService: WorkspaceService) {}

	async read(
		_ctx: WorkspaceContext
	): Promise<Result<Record<string, unknown>, Error>> {
		const toolchain = await this.workspaceService.detectToolchain();
		return ok({ toolchain });
	}
}
