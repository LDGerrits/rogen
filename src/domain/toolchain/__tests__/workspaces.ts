import { Luau } from "../luau.js";
import { RobloxTs, RobloxTsFacts } from "../roblox-ts.js";
import { Darklua, DetectedWorkspace, PackageManager } from "../toolchain.js";

export interface WorkspaceSpec {
	readonly language?: "luau" | "roblox-ts";
	readonly usesDarklua?: boolean;
	readonly packageManager?: "wally" | "pesde";
	readonly packageDirs?: Iterable<string>;
	readonly codeFolders?: readonly string[];
	readonly hasSrc?: boolean;
	readonly places?: readonly string[];
	readonly robloxTs?: RobloxTsFacts;
}

export function workspaceOf(spec: WorkspaceSpec = {}): DetectedWorkspace {
	return new DetectedWorkspace({
		darklua: new Darklua(),
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

export const withRobloxTs = (
	spec: WorkspaceSpec,
	facts: RobloxTsFacts
): WorkspaceSpec => ({ ...spec, robloxTs: { ...spec.robloxTs, ...facts } });
