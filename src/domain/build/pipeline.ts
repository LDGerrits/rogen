import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { SyncTool } from "../toolchain/toolchain.js";
import {
	AssemblyStage,
	BuildRecord,
	BuildRule,
	PlacementStage,
	SyncRule,
	startBuild,
} from "./build-record.js";
import { buriedScriptSuffix } from "./rules/buried-script-suffix.js";
import { capitalSuffix } from "./rules/capital-suffix.js";
import { caseMismatch } from "./rules/case-mismatch.js";
import { dormantCapitalSuffix } from "./rules/dormant-capital-suffix.js";
import { metaAppliesToNothing } from "./rules/meta-applies-to-nothing.js";
import { metaNotCopied } from "./rules/meta-not-copied.js";
import { metaNotSynced } from "./rules/meta-not-synced.js";
import { missingRootDir } from "./rules/missing-root-dir.js";
import { nothingEmitted } from "./rules/nothing-emitted.js";
import { runContextTarget } from "./rules/run-context-target.js";
import { templateClash } from "./rules/template-clash.js";
import { templateClass } from "./rules/template-class.js";
import { unclaimedMeta } from "./rules/unclaimed-meta.js";
import { unresolvedLink } from "./rules/unresolved-link.js";
import { unrouted } from "./rules/unrouted.js";
import { untaggedClash } from "./rules/untagged-clash.js";
import { applyFolderMeta } from "./stages/apply-folder-meta.js";
import { applyTags } from "./stages/apply-tags.js";
import { assembleTree } from "./stages/assemble-tree.js";
import { readFolderMeta } from "./stages/read-folder-meta.js";
import { routeFiles } from "./stages/route-files.js";
import { scanRoots } from "./stages/scan-roots.js";
import { yieldToTemplate } from "./stages/yield-to-template.js";

const PLACEMENT: readonly PlacementStage[] = [
	scanRoots,
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
