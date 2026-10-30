import { compareStrings } from "../../base/collections.js";
import { IpAddress } from "../../base/ip-address.js";
import { JsoncSpan, parseJsoncSpans } from "../../base/jsonc.js";
import {
	JsoncComments,
	JsoncMarks,
	JsoncPath,
} from "../../base/jsonc-comments.js";
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

/** The lists Rojo writes only when they hold something. */
const EMPTY_OMITTED = ["serveAllowedHosts", "globIgnorePaths", "syncRules"];

/** The sets of place IDs, which Rojo writes with each ID once. */
const PLACE_ID_KEYS = ["servePlaceIds", "blockedPlaceIds"];

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

/** A list whose items keep the index they had in the text, which their comments are filed under. */
class Listed {
	constructor(readonly items: Entries) {}
}

const INDENT = "  ";

/** The comments of the text a document is printed from, and which of them were printed. */
class Commented {
	private readonly used = new Set<string>();

	constructor(private readonly comments: JsoncComments) {}

	/** The comments filed under `path`, which count as printed once asked for. */
	take(path: JsoncPath): JsoncMarks {
		this.used.add(JsoncComments.key(path));
		return this.comments.at(path);
	}

	/** The comments of entries that the printed document no longer has, which end the document rather than get lost. */
	get unplaced(): (readonly string[])[] {
		return this.comments.paths
			.filter((key) => !this.used.has(key))
			.flatMap((key) => {
				const marks = this.comments.atKey(key);
				return [
					...marks.leading,
					...marks.opening,
					...marks.closing,
					...marks.trailing,
				];
			});
	}
}

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

	/** A config as text: Rojo's keys in Rojo's order with `rogenKeys` in the order given before the `tree`, then any other key. */
	static ofConfig(
		config: Record<string, unknown>,
		rogenKeys: readonly string[],
		/** The tree of a project file the config was lifted from, printed as it was written where it is unchanged. */
		written?: WrittenTree,
		/** The comments of the text the config was read from, each printed with the entry it was written with. */
		comments?: JsoncComments
	): string {
		const body = ProjectText.file(config, rogenKeys, written);
		if (!comments || comments.isEmpty) return ProjectText.print(body, "");
		const commented = new Commented(comments);
		const root = commented.take([]);
		const text = ProjectText.print(body, "", commented, []);
		return [
			...root.leading.map((comment) => comment.join("\n")),
			text,
			...[...root.trailing, ...commented.unplaced].map((comment) =>
				comment.join("\n")
			),
		].join("\n");
	}

	private static file(
		all: Record<string, unknown>,
		rogenKeys: readonly string[],
		written?: WrittenTree
	): Ordered {
		const tree = FILE_KEYS.indexOf("tree");
		const listed = [
			...FILE_KEYS.slice(0, tree),
			...rogenKeys,
			...FILE_KEYS.slice(tree),
		];
		const entries: [string, unknown][] = [];
		for (const key of listed)
			if (key in all && !ProjectText.isOmitted(key, all[key]))
				entries.push([
					key,
					key === "tree" && written
						? written.printed(all[key])
						: ProjectText.fileValue(key, all[key]),
				]);
		for (const key of Object.keys(all))
			if (!listed.includes(key)) entries.push([key, all[key]]);
		return new Ordered(entries);
	}

	/** Rojo leaves a list out of a project file when it has nothing in it. */
	private static isOmitted(key: string, value: unknown): boolean {
		return (
			EMPTY_OMITTED.includes(key) &&
			Array.isArray(value) &&
			value.length === 0
		);
	}

	private static fileValue(key: string, value: unknown): unknown {
		if (key === "tree" && isObject(value)) return ProjectText.node(value);
		if (PLACE_ID_KEYS.includes(key) && Array.isArray(value)) {
			const seen = new Set<unknown>();
			return new Listed(
				value.flatMap((id, at) =>
					seen.has(id) ? [] : (seen.add(id), [[String(at), id]])
				)
			);
		}
		if (key === "serveAddress" && typeof value === "string")
			return IpAddress.parse(value)?.toString() ?? value;
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
			if (key in node && !ProjectText.isEmptyMap(key, node[key]))
				entries.push([
					key,
					key === "$properties" || key === "$attributes"
						? ProjectText.sorted(node[key])
						: key === "$path"
							? ProjectText.slashed(node[key])
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

	/** Rojo leaves the properties and attributes of a node out when there are none. */
	private static isEmptyMap(key: string, value: unknown): boolean {
		return (
			(key === "$properties" || key === "$attributes") &&
			isObject(value) &&
			Object.keys(value).length === 0
		);
	}

	/** A `$path` written with `/`, as Rojo writes it on every system. */
	private static slashed(value: unknown): unknown {
		if (typeof value === "string") return value.replaceAll("\\", "/");
		if (isObject(value) && typeof value.optional === "string")
			return { ...value, optional: value.optional.replaceAll("\\", "/") };
		return value;
	}

	private static syncbackRules(rules: Record<string, unknown>): Ordered {
		const kept = Object.fromEntries(
			Object.entries(rules).filter(
				([key, value]) =>
					!(key === "ignoreTrees" || key === "ignorePaths"
						? Array.isArray(value) && value.length === 0
						: key === "ignoreProperties" &&
							isObject(value) &&
							Object.keys(value).length === 0)
			)
		);
		const { ignoreProperties } = kept;
		return ProjectText.inOrder(
			isObject(ignoreProperties)
				? {
						...kept,
						ignoreProperties:
							ProjectText.sortedKeys(ignoreProperties),
					}
				: kept,
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

	/** `serde_json`'s pretty form: two spaces, one entry per line, and `{}` and `[]` for nothing; with `commented`, the comments of the text each next to its entry. */
	private static print(
		value: unknown,
		indent: string,
		commented?: Commented,
		path: JsoncPath = []
	): string {
		if (value instanceof FloatText) return value.toString();
		if (value instanceof Raw)
			return value.lines
				.map((line, at) =>
					at === 0 || line === "" ? line : indent + line
				)
				.join("\n");
		const block = (
			open: string,
			close: string,
			items: readonly (readonly [string | number, string, unknown])[]
		) => ProjectText.block(open, close, items, indent, commented, path);
		if (value instanceof Ordered)
			return block(
				"{",
				"}",
				value.entries.map(([key, entry]) => [
					key,
					`${JSON.stringify(key)}: `,
					entry,
				])
			);
		if (value instanceof Listed)
			return block(
				"[",
				"]",
				value.items.map(([at, entry]) => [Number(at), "", entry])
			);
		if (Array.isArray(value))
			return block(
				"[",
				"]",
				value.map((entry, at) => [at, "", entry])
			);
		if (isObject(value))
			return ProjectText.print(
				new Ordered(Object.entries(value)),
				indent,
				commented,
				path
			);
		return JSON.stringify(value);
	}

	private static block(
		open: string,
		close: string,
		items: readonly (readonly [string | number, string, unknown])[],
		indent: string,
		commented: Commented | undefined,
		path: JsoncPath
	): string {
		const marks = commented?.take(path);
		if (
			items.length === 0 &&
			!marks?.opening.length &&
			!marks?.closing.length
		)
			return `${open}${close}`;
		const inner = indent + INDENT;
		const lines: string[] = [];
		items.forEach(([segment, label, entry], at) => {
			const own = commented?.take([...path, segment]);
			for (const comment of own?.leading ?? [])
				lines.push(...ProjectText.commentLines(comment, inner));
			const comma = at < items.length - 1 ? "," : "";
			lines.push(
				`${inner}${label}${ProjectText.print(entry, inner, commented, [...path, segment])}${comma}${ProjectText.sameLine(own?.trailing, inner)}`
			);
		});
		for (const comment of marks?.closing ?? [])
			lines.push(...ProjectText.commentLines(comment, inner));
		return `${open}${ProjectText.sameLine(marks?.opening, inner)}\n${lines.join("\n")}\n${indent}${close}`;
	}

	private static commentLines(
		comment: readonly string[],
		indent: string
	): string[] {
		return comment.map((line) => (line === "" ? "" : indent + line));
	}

	/** Comments that stand on the line of the entry, after what is printed there. */
	private static sameLine(
		comments: readonly (readonly string[])[] | undefined,
		indent: string
	): string {
		return (comments ?? [])
			.map(
				(comment) =>
					` ${comment.map((line, at) => (at === 0 || line === "" ? line : indent + line)).join("\n")}`
			)
			.join("");
	}
}
