import { FileSystemService } from "../../fs/file-system-service.js";
import { ok, Result } from "../../../base/result.js";
import { IConfigProvider, WorkspaceContext } from "./provider.js";
import { detectToolchain } from "../toolchain.js";

export class ToolchainProvider implements IConfigProvider {
	readonly name = "ToolchainProvider";

	constructor(private readonly fileSystemService: FileSystemService) {}

	async read(
		ctx: WorkspaceContext
	): Promise<Result<Record<string, unknown>, Error>> {
		const toolchain = await detectToolchain(
			ctx.cwd,
			this.fileSystemService
		);

		return ok({ toolchain });
	}
}
