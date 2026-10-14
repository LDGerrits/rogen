import { isGlobsetMatch } from "../../base/glob.js";

/** What a sync rule turns a file into, spelled as Rojo spells the `use` of a rule. */
export type SyncRuleUse =
	| "serverScript"
	| "clientScript"
	| "pluginScript"
	| "moduleScript"
	| "legacyClientScript"
	| "legacyServerScript"
	| "runContextServerScript"
	| "runContextClientScript"
	| "project"
	| "jsonModel"
	| "json"
	| "toml"
	| "csv"
	| "text"
	| "rbxm"
	| "rbxmx"
	| "yaml"
	| "ignore";

/** One rule that tells Rojo what a file is, as a project's `syncRules` list writes it. */
export interface SyncRule {
	readonly pattern: string;
	/** A file this matches is left to the rules after this one. */
	readonly exclude?: string;
	readonly use: SyncRuleUse;
	/** What is cut off the end of the file name to give the instance its name, the extension included; without it only the extension goes. */
	readonly suffix?: string;
}

/** The rule that gets a file a rule matched, and the name it gives the instance. */
interface SyncRuleMatch {
	readonly rule: SyncRule;
	readonly name: string;
}

/** The rules Rojo applies after a project's own, in its order. Init files and meta files are read apart from them, as in Rojo, and so are compiler sources. */
export const DEFAULT_SYNC_RULES: readonly SyncRule[] = [
	{ pattern: "*.server.lua", use: "serverScript", suffix: ".server.lua" },
	{ pattern: "*.server.luau", use: "serverScript", suffix: ".server.luau" },
	{ pattern: "*.client.lua", use: "clientScript", suffix: ".client.lua" },
	{ pattern: "*.client.luau", use: "clientScript", suffix: ".client.luau" },
	{ pattern: "*.plugin.lua", use: "pluginScript", suffix: ".plugin.lua" },
	{ pattern: "*.plugin.luau", use: "pluginScript", suffix: ".plugin.luau" },
	{ pattern: "*.{lua,luau}", use: "moduleScript" },
	{ pattern: "*.project.json", use: "project", suffix: ".project.json" },
	{ pattern: "*.project.jsonc", use: "project", suffix: ".project.jsonc" },
	{ pattern: "*.model.json", use: "jsonModel", suffix: ".model.json" },
	{ pattern: "*.model.jsonc", use: "jsonModel", suffix: ".model.jsonc" },
	{
		pattern: "*.json",
		exclude: "*.meta.json",
		use: "json",
		suffix: ".json",
	},
	{
		pattern: "*.jsonc",
		exclude: "*.meta.jsonc",
		use: "json",
		suffix: ".jsonc",
	},
	{ pattern: "*.toml", use: "toml" },
	{ pattern: "*.csv", use: "csv" },
	{ pattern: "*.txt", use: "text" },
	{ pattern: "*.rbxmx", use: "rbxmx" },
	{ pattern: "*.rbxm", use: "rbxm" },
	{ pattern: "*.{yml,yaml}", use: "yaml" },
];

/** A list of sync rules and the one way Rojo applies them to a file. */
export class SyncRules {
	static readonly DEFAULT = new SyncRules(DEFAULT_SYNC_RULES);

	constructor(private readonly rules: readonly SyncRule[]) {}

	/** The first rule that takes `filePath`, a path relative to the folder the rules are written for, written with `/`. */
	match(filePath: string): SyncRuleMatch | undefined {
		const rule = this.rules.find(
			({ pattern, exclude }) =>
				!(exclude && isGlobsetMatch(filePath, exclude)) &&
				isGlobsetMatch(filePath, pattern)
		);
		return rule && { rule, name: SyncRules.nameOf(rule, filePath) };
	}

	/** The instance name a rule gives `filePath`: the suffix cut off, or the whole file name when it does not end with it. */
	private static nameOf(rule: SyncRule, filePath: string): string {
		const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
		if (rule.suffix !== undefined)
			return fileName.endsWith(rule.suffix)
				? fileName.slice(0, fileName.length - rule.suffix.length)
				: fileName;
		const dot = fileName.lastIndexOf(".");
		return dot > 0 ? fileName.slice(0, dot) : fileName;
	}
}
