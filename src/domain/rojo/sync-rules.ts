import { isGlobsetMatch } from "../../base/glob.js";
import path from "path";
import { isObject } from "../../base/objects.js";

const SYNC_RULE_USES = [
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

/** The fields of a sync rule, in the order Rojo writes them. */
export const SYNC_RULE_FIELDS: readonly string[] = [
	"pattern",
	"exclude",
	"use",
	"suffix",
];

export type SyncRuleUse = (typeof SYNC_RULE_USES)[number];

export interface SyncRule {
	readonly pattern: string;
	readonly exclude?: string;
	readonly use: SyncRuleUse;
	readonly suffix?: string;
}

export interface SyncRuleMatch {
	readonly rule: SyncRule;
	readonly name: string;
	readonly own: boolean;
	readonly suffixMissed: boolean;
}

interface SyncRuleProblem {
	readonly index: number;
	readonly message: string;
}

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

	constructor(
		private readonly rules: readonly SyncRule[],
		private readonly ownCount = 0,
		readonly dir = ""
	) {}

	static following(own: readonly SyncRule[], dir: string): SyncRules {
		return new SyncRules([...own, ...DEFAULT_SYNC_RULES], own.length, dir);
	}

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

	static unknownFields(
		values: readonly unknown[]
	): { readonly index: number; readonly field: string }[] {
		return values.flatMap((value, index) =>
			isObject(value)
				? Object.keys(value)
						.filter((field) => !SYNC_RULE_FIELDS.includes(field))
						.map((field) => ({ index, field }))
				: []
		);
	}

	private static readRule(value: unknown): SyncRule | string {
		if (!isObject(value)) return "a sync rule must be an object.";
		const { pattern, exclude, use, suffix } = value;
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

	relativeDir(dir: string): string {
		return path.posix.relative(this.dir, dir);
	}

	get own(): readonly SyncRule[] {
		return this.rules.slice(0, this.ownCount);
	}

	match(filePath: string): SyncRuleMatch | undefined {
		const index = this.rules.findIndex((rule) =>
			SyncRules.takes(rule, filePath)
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
