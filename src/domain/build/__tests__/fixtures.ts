import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { createToolchainService } from "../../toolchain/__tests__/create-toolchain-service.js";
import { CoreBuildService } from "../core-build-service.js";

const toolchain = createToolchainService();

export const syncTools = toolchain.getSyncTools();

export const buildServiceOf = (fs: FileSystemService, index: IndexService) =>
	new CoreBuildService(fs, index, toolchain);

export const abs = (...segments: string[]): string =>
	path.resolve("/repo", ...segments);

export const configOf = (
	overrides: Partial<ResolvedConfig> = {}
): ResolvedConfig => ({
	file: abs("default.rogen.json"),
	name: "repo",
	rootDirs: [abs("src")],
	routes: { "*": "ReplicatedStorage" },
	tags: {},
	exclude: [],
	outFile: abs("default.project.json"),
	...overrides,
});

export async function writeFiles(
	fs: MemoryFileSystemService,
	...paths: string[]
): Promise<void> {
	for (const file of paths) await fs.writeFile(abs(file), "");
}

export async function indexOf(
	store: DisposableStore,
	fs: MemoryFileSystemService,
	rootDirs: readonly string[]
): Promise<CoreIndexService> {
	const index = store.add(new CoreIndexService(fs));
	await index.initialize([...rootDirs]);
	return index;
}
