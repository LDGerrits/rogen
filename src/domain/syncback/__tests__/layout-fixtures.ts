import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	abs,
	writeServiceOf,
	configOf,
	locateIn,
	writeFiles,
} from "../../write/__tests__/fixtures.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { SyncbackLayout } from "../syncback-layout.js";

export const ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	Shared: "ReplicatedStorage/Shared",
	"*": "ReplicatedStorage/Shared",
};

/** The layout the write finds for `files`, paths from the repo root and each an empty file. */
export async function layoutOf(
	files: readonly string[],
	spec: ResolvedConfigSpec = {}
): Promise<SyncbackLayout> {
	const fs = new MemoryFileSystemService();
	await writeFiles(fs, ...files);
	const config = configOf({ routes: ROUTES, ...spec });
	const located = (
		await locateIn(writeServiceOf(fs, new CoreIndexService(fs)), config)
	).unwrap();
	return new SyncbackLayout(config, located.files);
}

export { abs };
