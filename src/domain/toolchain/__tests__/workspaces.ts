import { Luau } from "../luau.js";
import { RobloxTs, RobloxTsFacts } from "../roblox-ts.js";
import { Darklua, DetectedWorkspace, PackageManager } from "../toolchain.js";

export interface WorkspaceSpec {
	readonly language?: "luau" | "roblox-ts";
	readonly darkluaConfig?: string;
	readonly packageManager?: "wally" | "pesde";
	readonly packageDirs?: Iterable<string>;
	readonly testRunner?: string;
	readonly robloxTs?: RobloxTsFacts;
}

export function workspaceOf(spec: WorkspaceSpec = {}): DetectedWorkspace {
	return new DetectedWorkspace({
		darklua: new Darklua(),
		languages: [
			new Luau(),
			new RobloxTs(spec.robloxTs ?? {}, spec.language === "roblox-ts"),
		],
		darkluaConfig: spec.darkluaConfig,
		packageManager:
			spec.packageManager === undefined
				? undefined
				: PackageManager[
						spec.packageManager === "wally" ? "WALLY" : "PESDE"
					],
		packageDirs: new Set(spec.packageDirs),
		testRunner: spec.testRunner,
	});
}

export const withRobloxTs = (
	spec: WorkspaceSpec,
	facts: RobloxTsFacts
): WorkspaceSpec => ({ ...spec, robloxTs: { ...spec.robloxTs, ...facts } });
