import path from "path";
import { toPosix } from "../../base/path.js";
import { commonRoot } from "../config/common-root.js";
import { Language } from "./detect-workspace.js";

const indent = (line: string) => `  ${line}`;

/** The long-running commands, grouped because each keeps its terminal busy. */
export const terminalSteps = (commands: readonly string[]): string[] => [
	"Run each in its own terminal:",
	...commands.map(indent),
];

/**
 * One `darklua process` per root dir. Each lands at its path relative to the
 * common root, which is where the synced project points.
 */
export function darkluaCommands(
	directory: string,
	rootDirs: readonly string[],
	syncDir: string
): string[] {
	const absolute = rootDirs.map((dir) => path.resolve(directory, dir));
	const common = commonRoot(absolute);
	return rootDirs.map((dir, index) => {
		const relative = toPosix(path.relative(common, absolute[index]));
		return `darklua process ${dir} ${relative ? `${syncDir}/${relative}` : syncDir}`;
	});
}

export const darkluaSteps = (commands: readonly string[]): string[] => [
	"Have Darklua process your code into the sync dir:",
	...commands.map(indent),
];

export function tagsStep(language: Language, configName: string): string {
	const extension = language === "roblox-ts" ? "ts" : "luau";
	return `Add tags under "tags" in ${configName} to swap in variants like Analytics.mock.${extension}.`;
}
