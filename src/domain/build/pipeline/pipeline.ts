import { Result, err, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import {
	AssemblyStage,
	BuildRecord,
	BuildRule,
	PlacementStage,
	SyncRule,
	startBuild,
} from "../build-record.js";
import { buriedScriptSuffix } from "../rules/tagging/buried-script-suffix.js";
import { capitalSuffix } from "../rules/routing/capital-suffix.js";
import { caseMismatch } from "../rules/routing/case-mismatch.js";
import { dormantCapitalSuffix } from "../rules/tagging/dormant-capital-suffix.js";
import { metaAppliesToNothing } from "../rules/meta/meta-applies-to-nothing.js";
import { metaNotCopied } from "../rules/meta/meta-not-copied.js";
import { metaNotSynced } from "../rules/sync/meta-not-synced.js";
import { missingRootDir } from "../rules/scan/missing-root-dir.js";
import { nothingEmitted } from "../rules/sync/nothing-emitted.js";
import { runContextTarget } from "../rules/template/run-context-target.js";
import { templateClash } from "../rules/template/template-clash.js";
import { templateClass } from "../rules/meta/template-class.js";
import { unclaimedMeta } from "../rules/meta/unclaimed-meta.js";
import { unresolvedLink } from "../rules/scan/unresolved-link.js";
import { unrouted } from "../rules/routing/unrouted.js";
import { untaggedClash } from "../rules/tagging/untagged-clash.js";
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

/** In the order their warnings are reported. */
const RULES: readonly BuildRule[] = [
	missingRootDir,
	unresolvedLink,
	unclaimedMeta,
	caseMismatch,
	capitalSuffix,
	unrouted,
	dormantCapitalSuffix,
	buriedScriptSuffix,
	untaggedClash,
	runContextTarget,
	templateClash,
	metaNotCopied,
	templateClass,
	metaAppliesToNothing,
];

const SYNC_RULES: readonly SyncRule[] = [nothingEmitted, metaNotSynced];

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

export function check(build: BuildRecord): Diagnostic[] {
	return RULES.flatMap((rule) => rule(build));
}

export async function checkSync(
	build: BuildRecord,
	fileSystem: FileSystemService
): Promise<Diagnostic[]> {
	const warnings: Diagnostic[] = [];
	for (const rule of SYNC_RULES)
		warnings.push(...(await rule(build, fileSystem)));
	return warnings;
}
