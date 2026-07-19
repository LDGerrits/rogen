import path from "path";
import { IFileSystem } from "../fs/file-system.js";

export interface ToolchainProfile {
	isTs: boolean;
	isWally: boolean;
	isPesde: boolean;
	isDarklua: boolean;
}

export async function detectToolchain(
	cwd: string,
	fs: IFileSystem
): Promise<ToolchainProfile> {
	const [isTs, isWally, isPesde, hasDarkluaJson, hasDarkluaJson5] =
		await Promise.all([
			fs.exists(path.join(cwd, "tsconfig.json")),
			fs.exists(path.join(cwd, "wally.toml")),
			fs.exists(path.join(cwd, "pesde.toml")),
			fs.exists(path.join(cwd, ".darklua.json")),
			fs.exists(path.join(cwd, ".darklua.json5")),
		]);

	return {
		isTs,
		isWally,
		isPesde,
		isDarklua: hasDarkluaJson || hasDarkluaJson5,
	};
}
