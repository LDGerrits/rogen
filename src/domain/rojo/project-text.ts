import { compareStrings } from "../../base/collections.js";
import { JsoncSpan, parseJsoncSpans } from "../../base/jsonc.js";
import { isObject, isSameJson } from "../../base/objects.js";
import { FloatText, PropertyValues } from "./property-values.js";
import { RojoProjectFile } from "./rojo-project.js";

/** The keys of a project file in the order Rojo writes them. */
const FILE_KEYS = [
	"$schema",
	"name",
	"tree",
	"servePort",
	"servePlaceIds",
	"blockedPlaceIds",
	"placeId",
	"gameId",
	"serveAddress",
	"serveAllowedHosts",
	"emitLegacyScripts",
	"globIgnorePaths",
	"syncbackRules",
	"syncRules",
];

/** The keys of a sync rule, in the order Rojo writes them. */
const SYNC_RULE_KEYS = ["pattern", "exclude", "use", "suffix"];

/** The keys of `syncbackRules`, in the order Rojo writes them. */
const SYNCBACK_RULE_KEYS = [
	"ignoreTrees",
	"ignorePaths",
	"ignoreProperties",
	"syncCurrentCamera",
	"syncUnscriptable",
	"ignoreReferents",
];

/** The node keys around the children, in the order Rojo writes them. */
const NODE_KEYS_BEFORE = ["$className", "$id"];
const NODE_KEYS_AFTER = [
	"$properties",
	"$attributes",
	"$ignoreUnknownInstances",
	"$path",
];

type Entries = readonly (readonly [string, unknown])[];

class Ordered {
	constructor(readonly entries: Entries) {}
}

const INDENT = "  ";

/** Text taken as it was written, whose lines after the first are relative to the entry it is printed in. */
class Raw {
	constructor(readonly lines: readonly string[]) {}
}

/** The `tree` of a project file, which a config that keeps it prints as the file had it. */
export class WrittenTree {
	private constructor(
		private readonly text: string,
		private readonly span: JsoncSpan
	) {}

	/** `undefined` when `text` isn't a project file with a tree. */
	static of(text: string): WrittenTree | undefined {
		const parsed = parseJsoncSpans(text);
		const tree = parsed?.root.properties?.find(
			({ name }) => name === "tree"
		);
		return parsed && tree && new WrittenTree(parsed.text, tree.value);
	}

	/** `tree` with each part of it that is as it was written taken from the text, with its numbers, key order, comments and trailing commas; only what differs is printed afresh. */
	printed(tree: unknown): unknown {
		return this.keep(tree, this.span);
	}

	private keep(value: unknown, span: JsoncSpan): unknown {
		if (isSameJson(value, span.value)) return this.raw(span);
		if (!isObject(value) || !span.properties) return value;
		const names = span.properties.map(({ name }) => name);
		if (new Set(names).size !== names.length) return value;
		const written = new Map(
			span.properties.map(({ name, value: child }) => [name, child])
		);
		const entries: [string, unknown][] = span.properties.flatMap(
			({ name, value: child }) =>
				Object.hasOwn(value, name)
					? [[name, this.keep(value[name], child)]]
					: []
		);
		const added = Object.fromEntries(
			Object.entries(value).filter(([name]) => !written.has(name))
		);
		const fresh = ProjectText.node(added).entries;
		const heads = (key: string) => NODE_KEYS_BEFORE.includes(key);
		return new Ordered([
			...fresh.filter(([key]) => heads(key)),
			...entries,
			...fresh.filter(([key]) => !heads(key)),
		]);
	}

	private raw({ start, end }: JsoncSpan): Raw {
		const lineStart = this.text.lastIndexOf("\n", start - 1) + 1;
		const base = /^[ \t]*/.exec(this.text.slice(lineStart))?.[0] ?? "";
		const unit = this.unit();
		const [first, ...rest] = this.text.slice(start, end).split(/\r?\n/);
		return new Raw([
			first,
			...rest.map((line) => {
				let body = line.startsWith(base)
					? line.slice(base.length)
					: line;
				let depth = 0;
				while (unit && body.startsWith(unit)) {
					body = body.slice(unit.length);
					depth++;
				}
				return body === "" ? "" : INDENT.repeat(depth) + body;
			}),
		]);
	}

	/** One level of the text's own indentation: the leading whitespace of its first indented line. */
	private unit(): string {
		return /^([ \t]+)["}\]]/m.exec(this.text)?.[1] ?? "";
	}
}

/** A project file as text, formatted as `rojo fmt-project` would. */
export class ProjectText {
	static of(file: RojoProjectFile): string {
		return ProjectText.print(ProjectText.file({ ...file }, []), "");
	}

	/** A config as text: Rojo's keys in Rojo's order, then `rogenKeys` in the order given, then any other key. */
	static ofConfig(
		config: Record<string, unknown>,
		rogenKeys: readonly string[],
		/** The tree of a project file the config was lifted from, printed as it was written where it is unchanged. */
		written?: WrittenTree
	): string {
		return ProjectText.print(
			ProjectText.file(config, rogenKeys, written),
			""
		);
	}

	private static file(
		all: Record<string, unknown>,
		rogenKeys: readonly string[],
		written?: WrittenTree
	): Ordered {
		const entries: [string, unknown][] = [];
		for (const key of FILE_KEYS)
			if (key in all)
				entries.push([
					key,
					key === "tree" && written
						? written.printed(all[key])
						: ProjectText.fileValue(key, all[key]),
				]);
		for (const key of rogenKeys)
			if (key in all) entries.push([key, all[key]]);
		const listed = [...FILE_KEYS, ...rogenKeys];
		for (const key of Object.keys(all))
			if (!listed.includes(key)) entries.push([key, all[key]]);
		return new Ordered(entries);
	}

	private static fileValue(key: string, value: unknown): unknown {
		if (key === "tree" && isObject(value)) return ProjectText.node(value);
		if (key === "syncRules" && Array.isArray(value))
			return value.map((rule) =>
				isObject(rule)
					? ProjectText.inOrder(rule, SYNC_RULE_KEYS)
					: rule
			);
		if (key === "syncbackRules" && isObject(value))
			return ProjectText.syncbackRules(value);
		return value;
	}

	/** The entries of a tree node in Rojo's order. */
	static node(node: Record<string, unknown>): Ordered {
		const entries: [string, unknown][] = [];
		for (const key of NODE_KEYS_BEFORE)
			if (key in node) entries.push([key, node[key]]);
		const children = Object.keys(node)
			.filter((key) => !key.startsWith("$"))
			.sort(compareStrings);
		for (const child of children) {
			const value = node[child];
			entries.push([
				child,
				isObject(value) ? ProjectText.node(value) : value,
			]);
		}
		for (const key of NODE_KEYS_AFTER)
			if (key in node)
				entries.push([
					key,
					key === "$properties" || key === "$attributes"
						? ProjectText.sorted(node[key])
						: node[key],
				]);
		for (const key of Object.keys(node))
			if (
				key.startsWith("$") &&
				![...NODE_KEYS_BEFORE, ...NODE_KEYS_AFTER].includes(key)
			)
				entries.push([key, node[key]]);
		return new Ordered(entries);
	}

	private static syncbackRules(rules: Record<string, unknown>): Ordered {
		const { ignoreProperties } = rules;
		return ProjectText.inOrder(
			isObject(ignoreProperties)
				? {
						...rules,
						ignoreProperties:
							ProjectText.sortedKeys(ignoreProperties),
					}
				: rules,
			SYNCBACK_RULE_KEYS
		);
	}

	/** `value` with `keys` first, in that order, then any others as they were. */
	private static inOrder(
		value: Record<string, unknown>,
		keys: readonly string[]
	): Ordered {
		return new Ordered([
			...keys
				.filter((key) => key in value)
				.map((key) => [key, value[key]] as const),
			...Object.entries(value).filter(([key]) => !keys.includes(key)),
		]);
	}

	private static sortedKeys(value: Record<string, unknown>): Ordered {
		return new Ordered(
			Object.keys(value)
				.sort(compareStrings)
				.map((key) => [key, value[key]])
		);
	}

	private static sorted(value: unknown): unknown {
		if (!isObject(value)) return value;
		const typed = PropertyValues.typed(value);
		return new Ordered(
			Object.keys(typed)
				.sort(compareStrings)
				.map((key) => [key, typed[key]])
		);
	}

	/** `serde_json`'s pretty form: two spaces, one entry per line, and `{}` and `[]` for nothing. */
	private static print(value: unknown, indent: string): string {
		const inner = indent + INDENT;
		if (value instanceof FloatText) return value.toString();
		if (value instanceof Raw)
			return value.lines
				.map((line, at) =>
					at === 0 || line === "" ? line : indent + line
				)
				.join("\n");
		if (value instanceof Ordered)
			return value.entries.length === 0
				? "{}"
				: `{\n${value.entries
						.map(
							([key, entry]) =>
								`${inner}${JSON.stringify(key)}: ${ProjectText.print(entry, inner)}`
						)
						.join(",\n")}\n${indent}}`;
		if (Array.isArray(value))
			return value.length === 0
				? "[]"
				: `[\n${value
						.map(
							(entry) =>
								`${inner}${ProjectText.print(entry, inner)}`
						)
						.join(",\n")}\n${indent}]`;
		if (isObject(value))
			return ProjectText.print(
				new Ordered(Object.entries(value)),
				indent
			);
		return JSON.stringify(value);
	}
}
