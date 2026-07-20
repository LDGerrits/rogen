import { ok, Result } from "../../../base/result.js";
import { ConfigProvider } from "./provider.js";
import { WorkspaceService } from "../../workspace/workspace-service.js";

export class ToolchainProvider implements ConfigProvider {
	readonly name = "ToolchainProvider";

	constructor(private readonly workspaceService: WorkspaceService) {}

	async load(): Promise<Result<Record<string, unknown>, Error>> {
		const toolchain = await this.workspaceService.detectToolchain();
		return ok({ toolchain });
	}
}
