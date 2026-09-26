import { toPosix } from "../../base/path.js";
import { DetectedWorkspace, Language } from "./detect-workspace.js";

const DEFAULT_ROOT_DIR = "src";

/** The first that applies: tsconfig's `rootDir`, `src`, the only code folder, else `src`. */
export function defaultRootDir(
	workspace: DetectedWorkspace,
	language: Language
): string {
	if (language === "roblox-ts" && workspace.rootDir) {
		return toPosix(workspace.rootDir).replace(/^\.\//, "");
	}
	if (workspace.hasSrc) return DEFAULT_ROOT_DIR;
	return workspace.codeFolders.length === 1
		? workspace.codeFolders[0]
		: DEFAULT_ROOT_DIR;
}

/** The hint line naming the code folders the placeholder doesn't cover, or `undefined` when there are none. */
export function otherCodeFoldersHint(
	workspace: DetectedWorkspace,
	rootDir: string
): string | undefined {
	const [topLevel] = rootDir.split("/");
	const others = workspace.codeFolders.filter(
		(folder) => folder !== topLevel
	);
	return others.length > 0
		? `Also found code in: ${others.join(", ")}`
		: undefined;
}
