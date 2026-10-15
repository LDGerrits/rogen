import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	abs,
	buildServiceOf,
	configOf,
	locateIn,
	writeFiles,
} from "../../build/__tests__/fixtures.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { SyncbackLayout } from "../syncback-layout.js";

export const ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	Shared: "ReplicatedStorage/Shared",
	"*": "ReplicatedStorage/Shared",
};

/** The layout the build finds for `files`, paths from the repo root and each an empty file. */
export async function layoutOf(
	files: readonly string[],
	spec: ResolvedConfigSpec = {}
): Promise<SyncbackLayout> {
	const fs = new MemoryFileSystemService();
	await writeFiles(fs, ...files);
	const config = configOf({ routes: ROUTES, ...spec });
	const located = (
		await locateIn(buildServiceOf(fs, new CoreIndexService(fs)), config)
	).unwrap();
	return new SyncbackLayout(config, located.files);
}

export { abs };
