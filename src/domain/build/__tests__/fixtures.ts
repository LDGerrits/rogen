import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";

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
