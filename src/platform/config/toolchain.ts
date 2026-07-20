import path from "path";
import { FileSystemService } from "../fs/file-system-service.js";

export interface ToolchainProfile {
	isTs: boolean;
	isWally: boolean;
	isPesde: boolean;
	isDarklua: boolean;
}

export async function detectToolchain(
	cwd: string,
	fileSystemService: FileSystemService
): Promise<ToolchainProfile> {
	const [isTs, isWally, isPesde, hasDarkluaJson, hasDarkluaJson5] =
		await Promise.all([
			fileSystemService.exists(path.join(cwd, "tsconfig.json")),
			fileSystemService.exists(path.join(cwd, "wally.toml")),
			fileSystemService.exists(path.join(cwd, "pesde.toml")),
			fileSystemService.exists(path.join(cwd, ".darklua.json")),
			fileSystemService.exists(path.join(cwd, ".darklua.json5")),
		]);

	return {
		isTs,
		isWally,
		isPesde,
		isDarklua: hasDarkluaJson || hasDarkluaJson5,
	};
}
