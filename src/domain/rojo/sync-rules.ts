import { isGlobsetMatch } from "../../base/glob.js";
import path from "path";
import { isObject } from "../../base/objects.js";
import { joinPosix } from "../../base/path.js";

export const SYNC_RULE_USES = [
	"serverScript",
	"clientScript",
	"pluginScript",
	"moduleScript",
	"legacyClientScript",
	"legacyServerScript",
	"runContextServerScript",
	"runContextClientScript",
	"project",
	"jsonModel",
	"json",
	"toml",
	"csv",
	"text",
	"rbxm",
	"rbxmx",
	"yaml",
	"ignore",
] as const;

const SYNC_RULE_FIELDS: readonly string[] = [
	"pattern",
	"exclude",
	"use",
	"suffix",
];

/** What a sync rule turns a file into, spelled as Rojo spells the `use` of a rule. */
export type SyncRuleUse = (typeof SYNC_RULE_USES)[number];

export interface SyncRule {
	readonly pattern: string;
	/** A file this matches is left to the rules after this one. */
	readonly exclude?: string;
	readonly use: SyncRuleUse;
	/** What is cut off the end of the file name to give the instance its name, the extension included; without it only the extension goes. */
	readonly suffix?: string;
}

export interface SyncRuleMatch {
	readonly rule: SyncRule;
	readonly name: string;
	/** Whether the rule is one the project wrote rather than one of Rojo's. */
	readonly own: boolean;
	/** Whether the rule has a suffix the file name does not end with, so the whole file name is the instance name. */
	readonly suffixMissed: boolean;
}

/** What is wrong with the rule at `index` of a project's `syncRules`. */
export interface SyncRuleProblem {
	readonly index: number;
	readonly message: string;
}

/** The rules Rojo applies after a project's own, in its order. */
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

export class SyncRules {
	static readonly DEFAULT = new SyncRules(DEFAULT_SYNC_RULES);

	/** `dir` is the absolute POSIX folder the paths to match are relative to; the patterns of the first `ownCount` rules are relative to `ownDir`. */
	constructor(
		private readonly rules: readonly SyncRule[],
		private readonly ownCount = 0,
		private readonly dir = "",
		readonly ownDir = dir
	) {}

	/** `own` in front of Rojo's rules, the first match winning; their patterns are relative to `ownDir`, which differs from `dir` for rules a place inherits. */
	static following(
		own: readonly SyncRule[],
		dir: string,
		ownDir = dir
	): SyncRules {
		return new SyncRules(
			[...own, ...DEFAULT_SYNC_RULES],
			own.length,
			dir,
			ownDir
		);
	}

	/** The rules a project's `syncRules` holds, and what is wrong with the ones it can't read. */
	static read(values: readonly unknown[]): {
		readonly rules: SyncRule[];
		readonly problems: SyncRuleProblem[];
	} {
		const rules: SyncRule[] = [];
		const problems: SyncRuleProblem[] = [];
		values.forEach((value, index) => {
			const rule = SyncRules.readRule(value);
			if (typeof rule === "string")
				problems.push({ index, message: rule });
			else rules.push(rule);
		});
		return { rules, problems };
	}

	private static readRule(value: unknown): SyncRule | string {
		if (!isObject(value)) return "a sync rule must be an object.";
		const { pattern, exclude, use, suffix } = value;
		const unknown = Object.keys(value).find(
			(key) => !SYNC_RULE_FIELDS.includes(key)
		);
		if (unknown !== undefined)
			return `a sync rule has no "${unknown}" field; it takes ${SYNC_RULE_FIELDS.join(", ")}.`;
		if (typeof pattern !== "string")
			return 'a sync rule needs a "pattern" string.';
		if (!SYNC_RULE_USES.some((known) => known === use))
			return `a sync rule needs a "use" of ${SYNC_RULE_USES.join(", ")}.`;
		if (exclude !== undefined && typeof exclude !== "string")
			return '"exclude" of a sync rule must be a string.';
		if (suffix !== undefined && typeof suffix !== "string")
			return '"suffix" of a sync rule must be a string.';
		return {
			pattern,
			...(exclude !== undefined && { exclude }),
			use: use as SyncRuleUse,
			...(suffix !== undefined && { suffix }),
		};
	}

	/** `dir`, an absolute POSIX folder, relative to the folder the rules are written for. */
	relativeDir(dir: string): string {
		return path.posix.relative(this.dir, dir);
	}

	/** The rules the project wrote, in front of Rojo's. */
	get own(): readonly SyncRule[] {
		return this.rules.slice(0, this.ownCount);
	}

	/** The first rule that takes `filePath`, a path relative to the folder the rules are written for, written with `/`. */
	match(filePath: string): SyncRuleMatch | undefined {
		const fromOwnDir =
			this.ownDir === this.dir
				? filePath
				: path.posix.relative(
						this.ownDir,
						joinPosix(this.dir, filePath)
					);
		const index = this.rules.findIndex((rule, at) =>
			SyncRules.takes(rule, at < this.ownCount ? fromOwnDir : filePath)
		);
		if (index === -1) return undefined;
		const rule = this.rules[index];
		const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
		const suffixMissed =
			rule.suffix !== undefined && !fileName.endsWith(rule.suffix);
		return {
			rule,
			name: SyncRules.nameOf(rule, fileName, suffixMissed),
			own: index < this.ownCount,
			suffixMissed,
		};
	}

	private static takes(
		{ pattern, exclude }: SyncRule,
		filePath: string
	): boolean {
		return (
			!(exclude && isGlobsetMatch(filePath, exclude)) &&
			isGlobsetMatch(filePath, pattern)
		);
	}

	private static nameOf(
		rule: SyncRule,
		fileName: string,
		suffixMissed: boolean
	): string {
		if (rule.suffix !== undefined)
			return suffixMissed
				? fileName
				: fileName.slice(0, fileName.length - rule.suffix.length);
		const dot = fileName.lastIndexOf(".");
		return dot > 0 ? fileName.slice(0, dot) : fileName;
	}
}
