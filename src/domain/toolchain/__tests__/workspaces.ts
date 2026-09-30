import { Luau } from "../luau.js";
import { RobloxTs, RobloxTsFacts } from "../roblox-ts.js";
import { DetectedWorkspace, PackageManager } from "../toolchain.js";

/** A workspace as a test describes it; what it leaves out is what a bare directory has. */
export interface WorkspaceSpec {
	/** The language the workspace uses; Luau when none. */
	readonly language?: "luau" | "roblox-ts";
	readonly usesDarklua?: boolean;
	readonly packageManager?: "wally" | "pesde";
	readonly packageDirs?: Iterable<string>;
	readonly codeFolders?: readonly string[];
	readonly hasSrc?: boolean;
	readonly places?: readonly string[];
	/** What roblox-ts read, whether or not the workspace uses it. */
	readonly robloxTs?: RobloxTsFacts;
}

export function workspaceOf(spec: WorkspaceSpec = {}): DetectedWorkspace {
	return new DetectedWorkspace({
		languages: [
			new Luau(),
			new RobloxTs(spec.robloxTs ?? {}, spec.language === "roblox-ts"),
		],
		usesDarklua: spec.usesDarklua ?? false,
		packageManager:
			spec.packageManager === undefined
				? undefined
				: PackageManager[
						spec.packageManager === "wally" ? "WALLY" : "PESDE"
					],
		packageDirs: new Set(spec.packageDirs),
		codeFolders: spec.codeFolders ?? [],
		hasSrc: spec.hasSrc ?? false,
		places: spec.places ?? [],
	});
}

/** `spec` with more of the facts roblox-ts read from it. */
export const withRobloxTs = (
	spec: WorkspaceSpec,
	facts: RobloxTsFacts
): WorkspaceSpec => ({ ...spec, robloxTs: { ...spec.robloxTs, ...facts } });
