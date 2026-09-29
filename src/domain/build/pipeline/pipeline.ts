import { Result, err, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import {
	AssembledBuild,
	PlacedBuild,
	PreparedBuild,
} from "../model/build-phases.js";
import { applyFolderMeta } from "./assembly/apply-folder-meta.js";
import { assembleTree } from "./assembly/assemble-tree.js";
import { readFolderMeta } from "./assembly/read-folder-meta.js";
import { applyTags } from "./placement/apply-tags.js";
import { readPaths } from "./placement/read-paths.js";
import { routeFiles } from "./placement/route-files.js";
import { scanRoots } from "./placement/scan-roots.js";
import { yieldToTemplate } from "./placement/yield-to-template.js";
import { prepareBuild } from "./prepare-build.js";

/** Where every scanned file lands, or why it lands nowhere. */
export function place(
	index: IndexReader,
	config: ResolvedConfig,
	tools: readonly SyncTool[]
): Result<PlacedBuild, Diagnostic[]> {
	return prepareBuild(index, config, tools).flatMap(placeFiles);
}

function placeFiles(
	prepared: PreparedBuild
): Result<PlacedBuild, Diagnostic[]> {
	const roots = scanRoots(prepared);
	const readings = readPaths(prepared, roots);
	const routing = routeFiles(prepared, roots, readings);
	const tagging = applyTags(prepared, routing.routed);
	if (tagging.isErr()) return tagging;
	const templating = yieldToTemplate(prepared, tagging.value.files);

	return ok({
		...prepared,
		roots,
		readings,
		routed: routing.routed,
		files: templating.files,
		clashes: tagging.value.clashes,
		leftOut: new Map([
			...roots.flatMap((root) => [...root.leftOut]),
			...routing.leftOut,
			...tagging.value.leftOut,
			...templating.leftOut,
		]),
	});
}

/** Builds the tree from a placed build, reading folder meta from `fileSystem`. */
export async function assemble(
	placed: PlacedBuild,
	fileSystem: FileSystemService
): Promise<Result<AssembledBuild, Diagnostic[]>> {
	const folderMeta = await readFolderMeta(placed.roots, fileSystem);
	if (folderMeta.isErr()) return err(folderMeta.error);

	const assembly = assembleTree(placed);
	const applied = applyFolderMeta(placed, folderMeta.value, assembly);
	if (applied.isErr()) return err(applied.error);

	return ok({
		...placed,
		folderMeta: folderMeta.value,
		collapsed: assembly.collapsed,
		tree: applied.value.tree,
		metaOutcomes: applied.value.metaOutcomes,
	});
}
