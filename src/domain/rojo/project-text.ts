import { compareByCodePoint } from "../../base/collections.js";
import { IpAddress } from "../../base/ip-address.js";
import { JsoncSpan, parseJsoncSpans } from "../../base/jsonc.js";
import {
	JsoncComments,
	JsoncDocumentMarks,
	JsoncMarks,
	JsoncPath,
} from "../../base/jsonc-comments.js";
import { isObject, isSameJson } from "../../base/objects.js";
import { FloatText, PropertyValues } from "./property-values.js";
import { NODE_FIELDS, RojoProjectFile, isChildNode } from "./rojo-project.js";
import { SYNC_RULE_FIELDS } from "./sync-rules.js";

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

const EMPTY_OMITTED = ["serveAllowedHosts", "globIgnorePaths", "syncRules"];

/** The sets of place IDs, which Rojo writes with each ID once. */
const PLACE_ID_KEYS = ["servePlaceIds", "blockedPlaceIds"];

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

class Listed {
	constructor(readonly items: Entries) {}
}

const INDENT = "  ";

class Commented {
	private readonly used = new Set<string>();

	constructor(private readonly comments: JsoncComments) {}

	take(path: JsoncPath): JsoncMarks {
		this.used.add(JsoncComments.key(path));
		return this.comments.at(path);
	}

	takeDocument(): JsoncDocumentMarks {
		this.used.add(JsoncComments.key([]));
		return this.comments.aroundDocument();
	}

	takeOrphansUnder(path: JsoncPath): (readonly string[])[] {
		const kept: (readonly string[])[] = [];
		for (const key of this.comments.paths) {
			const at = JSON.parse(key) as JsoncPath;
			if (
				this.used.has(key) ||
				at.length <= path.length ||
				!path.every((segment, index) => at[index] === segment)
			)
				continue;
			this.used.add(key);
			const marks = this.comments.at(at);
			kept.push(
				...marks.leading,
				...marks.opening,
				...marks.closing,
				...marks.trailing
			);
		}
		return kept;
	}
}

class Raw {
	constructor(readonly lines: readonly string[]) {}
}

type BlockItems = readonly (readonly [string | number, string, unknown])[];

class OpenBlock {
	readonly inner: string;
	readonly marks: JsoncMarks | undefined;
	at = 0;
	own: JsoncMarks | undefined;

	constructor(
		readonly open: string,
		readonly close: string,
		readonly items: BlockItems,
		readonly indent: string,
		readonly path: JsoncPath,
		commented: Commented | undefined
	) {
		this.inner = indent + INDENT;
		this.marks = commented?.take(path);
	}
}

export class WrittenTree {
	private constructor(
		private readonly text: string,
		private readonly span: JsoncSpan
	) {}

	static of(text: string): WrittenTree | undefined {
		const parsed = parseJsoncSpans(text);
		const tree = parsed?.root.properties?.find(
			({ name }) => name === "tree"
		);
		if (!parsed || !tree) return undefined;
		const { start, end } = tree.value;
		return parsed.text.slice(start, end).includes("\n")
			? new WrittenTree(parsed.text, tree.value)
			: undefined;
	}

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
		const base = /^[ \t]*/.exec(this.text.slice(lineStart))![0];
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

	private unit(): string {
		return /^([ \t]+)["}\]]/m.exec(this.text)?.[1] ?? "";
	}
}

export class ProjectText {
	static of(file: RojoProjectFile): string {
		return ProjectText.print(ProjectText.file({ ...file }, []), "");
	}

	static ofConfig(
		config: Record<string, unknown>,
		rogenKeys: readonly string[],
		written?: WrittenTree,
		comments?: JsoncComments
	): string {
		const body = ProjectText.file(config, rogenKeys, written);
		if (!comments || comments.isEmpty) return ProjectText.print(body, "");
		const commented = new Commented(comments);
		const around = commented.takeDocument();
		const text = ProjectText.print(body, "", commented, []);
		return [
			...around.beforeDocument.map((comment) => comment.join("\n")),
			text,
			...around.afterDocument.map((comment) => comment.join("\n")),
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
					? ProjectText.inOrder(rule, SYNC_RULE_FIELDS)
					: rule
			);
		if (key === "syncbackRules" && isObject(value))
			return ProjectText.syncbackRules(value);
		return value;
	}

	static node(node: Record<string, unknown>): Ordered {
		const entries: [string, unknown][] = [];
		const pending: (readonly [Record<string, unknown>, Entries])[] = [
			[node, entries],
		];
		const descend = (child: Record<string, unknown>): Ordered => {
			const inner: [string, unknown][] = [];
			pending.push([child, inner]);
			return new Ordered(inner);
		};
		for (let next = pending.pop(); next; next = pending.pop())
			ProjectText.fillNode(
				next[0],
				next[1] as [string, unknown][],
				descend
			);
		return new Ordered(entries);
	}

	private static fillNode(
		node: Record<string, unknown>,
		entries: [string, unknown][],
		descend: (child: Record<string, unknown>) => Ordered
	): void {
		for (const key of NODE_KEYS_BEFORE)
			if (key in node) entries.push([key, node[key]]);
		const isChild = (key: string) =>
			isChildNode(key, node[key]) || !key.startsWith("$");
		const children = Object.keys(node)
			.filter(isChild)
			.sort(compareByCodePoint);
		for (const child of children) {
			const value = node[child];
			entries.push([child, isObject(value) ? descend(value) : value]);
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
			if (!NODE_FIELDS.has(key) && !isChild(key))
				entries.push([key, node[key]]);
	}

	private static isEmptyMap(key: string, value: unknown): boolean {
		return (
			(key === "$properties" || key === "$attributes") &&
			isObject(value) &&
			Object.keys(value).length === 0
		);
	}

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
				.sort(compareByCodePoint)
				.map((key) => [key, value[key]])
		);
	}

	private static sorted(value: unknown): unknown {
		if (!isObject(value)) return value;
		const typed = PropertyValues.typed(value);
		return new Ordered(
			Object.keys(typed)
				.sort(compareByCodePoint)
				.map((key) => [key, typed[key]])
		);
	}

	private static print(
		value: unknown,
		indent: string,
		commented?: Commented,
		path: JsoncPath = []
	): string {
		const out: string[] = [];
		const open: OpenBlock[] = [];
		ProjectText.emit(value, indent, path, commented, out, open);
		while (open.length > 0) {
			const block = open[open.length - 1];
			const item = block.items[block.at];
			if (item === undefined) {
				ProjectText.close(block, commented, out);
				open.pop();
				const parent = open[open.length - 1];
				if (parent) ProjectText.endItem(parent, out);
				continue;
			}
			const [segment, label, entry] = item;
			if (block.at === 0) out.push("\n");
			block.own = commented?.take([...block.path, segment]);
			for (const comment of block.own?.leading ?? [])
				for (const line of ProjectText.commentLines(
					comment,
					block.inner
				))
					out.push(line, "\n");
			out.push(block.inner, label);
			const depth = open.length;
			ProjectText.emit(
				entry,
				block.inner,
				[...block.path, segment],
				commented,
				out,
				open
			);
			if (open.length === depth) ProjectText.endItem(block, out);
		}
		return out.join("");
	}

	private static emit(
		value: unknown,
		indent: string,
		path: JsoncPath,
		commented: Commented | undefined,
		out: string[],
		open: OpenBlock[]
	): void {
		if (value instanceof FloatText) return void out.push(value.toString());
		if (value instanceof Raw)
			return void out.push(
				value.lines
					.map((line, at) =>
						at === 0 || line === "" ? line : indent + line
					)
					.join("\n")
			);
		const block = (
			opener: string,
			closer: string,
			items: BlockItems
		): void => {
			const opened = new OpenBlock(
				opener,
				closer,
				items,
				indent,
				path,
				commented
			);
			out.push(
				opener,
				ProjectText.sameLine(opened.marks?.opening, opened.inner)
			);
			open.push(opened);
		};
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
			return ProjectText.emit(
				new Ordered(Object.entries(value)),
				indent,
				path,
				commented,
				out,
				open
			);
		out.push(JSON.stringify(value));
	}

	private static endItem(block: OpenBlock, out: string[]): void {
		const comma = block.at < block.items.length - 1 ? "," : "";
		out.push(
			comma,
			ProjectText.sameLine(block.own?.trailing, block.inner),
			"\n"
		);
		block.at++;
	}

	private static close(
		{ close, items, marks, path, indent, inner }: OpenBlock,
		commented: Commented | undefined,
		out: string[]
	): void {
		const lines = [
			...(marks?.closing ?? []),
			...(commented?.takeOrphansUnder(path) ?? []),
		].flatMap((comment) => ProjectText.commentLines(comment, inner));
		if (items.length === 0 && lines.length === 0) {
			const opening = ProjectText.sameLine(marks?.opening, inner);
			out.push(opening ? `\n${indent}${close}` : close);
			return;
		}
		if (items.length === 0) out.push("\n");
		for (const line of lines) out.push(line, "\n");
		out.push(indent, close);
	}

	private static commentLines(
		comment: readonly string[],
		indent: string
	): string[] {
		return comment.map((line) => (line === "" ? "" : indent + line));
	}

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
