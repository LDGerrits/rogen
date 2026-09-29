import { Result, err, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import {
	AssemblyStage,
	BuildRecord,
	PlacementStage,
	startBuild,
} from "../build-record.js";
import { applyFolderMeta } from "./assembly/apply-folder-meta.js";
import { applyTags } from "./placement/apply-tags.js";
import { assembleTree } from "./assembly/assemble-tree.js";
import { readFolderMeta } from "./assembly/read-folder-meta.js";
import { readPaths } from "./placement/read-paths.js";
import { routeFiles } from "./placement/route-files.js";
import { scanRoots } from "./placement/scan-roots.js";
import { yieldToTemplate } from "./placement/yield-to-template.js";

const PLACEMENT: readonly PlacementStage[] = [
	scanRoots,
	readPaths,
	routeFiles,
	applyTags,
	yieldToTemplate,
];

const ASSEMBLY: readonly AssemblyStage[] = [
	readFolderMeta,
	assembleTree,
	applyFolderMeta,
];

/** Where every scanned file lands, or why it lands nowhere. */
export function place(
	index: IndexReader,
	config: ResolvedConfig,
	tools: readonly SyncTool[]
): Result<BuildRecord, Diagnostic[]> {
	let build = startBuild(index, config, tools);
	for (const stage of PLACEMENT) {
		const next = stage(build);
		if (next.isErr()) return next;
		build = next.value;
	}
	return ok(build);
}

/** Builds the tree from a placed build, reading folder meta from `fileSystem`. */
export async function assemble(
	placed: BuildRecord,
	fileSystem: FileSystemService
): Promise<Result<BuildRecord, Diagnostic[]>> {
	let build = placed;
	for (const stage of ASSEMBLY) {
		const next = await stage(build, fileSystem);
		if (next.isErr()) return err(next.error);
		build = next.value;
	}
	return ok(build);
}
