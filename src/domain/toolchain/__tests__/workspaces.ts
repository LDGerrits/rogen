import { RobloxTsFacts } from "../roblox-ts.js";
import { DetectedWorkspace } from "../toolchain.js";

/** The `languageFacts` of a workspace where roblox-ts read `facts`. */
export const robloxTsFacts = (
	facts: RobloxTsFacts
): DetectedWorkspace["languageFacts"] => ({ "roblox-ts": facts });

/** `workspace` with more of the facts roblox-ts read from it. */
export const withRobloxTs = (
	workspace: DetectedWorkspace,
	facts: RobloxTsFacts
): DetectedWorkspace => ({
	...workspace,
	languageFacts: {
		...workspace.languageFacts,
		"roblox-ts": {
			...(workspace.languageFacts["roblox-ts"] as RobloxTsFacts),
			...facts,
		},
	},
});
