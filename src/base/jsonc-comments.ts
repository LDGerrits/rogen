import { Node, ParseError, parseTree, visit } from "jsonc-parser";

const BYTE_ORDER_MARK = 0xfeff;

export type JsoncPath = readonly (string | number)[];

export interface JsoncMarks {
	readonly leading: readonly (readonly string[])[];
	readonly trailing: readonly (readonly string[])[];
	readonly opening: readonly (readonly string[])[];
	readonly closing: readonly (readonly string[])[];
}

export interface JsoncDocumentMarks {
	readonly beforeDocument: readonly (readonly string[])[];
	readonly afterDocument: readonly (readonly string[])[];
}

interface Located {
	readonly start: number;
	readonly end: number;
	readonly node: Node;
	readonly segment: string | number;
}

interface Found {
	readonly start: number;
	readonly end: number;
}

type Bucket = "leading" | "trailing" | "opening" | "closing";

const ONLY_A_COMMA = /^[ \t\r]*,?[ \t\r]*$/;

export class JsoncComments {
	private readonly marks = new Map<string, Record<Bucket, string[][]>>();

	private constructor(private readonly text: string) {}

	static of(text: string): JsoncComments | undefined {
		const source =
			text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
		const errors: ParseError[] = [];
		const root = parseTree(source, errors, { allowTrailingComma: true });
		if (!root || errors.length > 0) return undefined;
		const found: Found[] = [];
		visit(
			source,
			{
				onComment: (offset, length) =>
					found.push({ start: offset, end: offset + length }),
			},
			{ allowTrailingComma: true }
		);
		const comments = new JsoncComments(source);
		for (const comment of found) comments.attach(comment, root, [], found);
		return comments;
	}

	get isEmpty(): boolean {
		return this.marks.size === 0;
	}

	at(path: JsoncPath): JsoncMarks {
		return (
			this.marks.get(JsoncComments.key(path)) ?? {
				leading: [],
				trailing: [],
				opening: [],
				closing: [],
			}
		);
	}

	aroundDocument(): JsoncDocumentMarks {
		const { leading, trailing } = this.at([]);
		return { beforeDocument: leading, afterDocument: trailing };
	}

	get paths(): string[] {
		return [...this.marks.keys()];
	}

	static key(path: JsoncPath): string {
		return JSON.stringify(path);
	}

	private attach(
		comment: Found,
		node: Node,
		path: JsoncPath,
		all: readonly Found[]
	): void {
		if (comment.end <= node.offset)
			return this.add(path, "leading", comment);
		if (comment.start >= node.offset + node.length)
			return this.add(path, "trailing", comment);
		const children = JsoncComments.children(node);
		const inside = children.find(
			(child) => child.start <= comment.start && comment.end <= child.end
		);
		if (inside) {
			const value = JsoncComments.valueOf(inside.node);
			const container = value.type === "object" || value.type === "array";
			if (
				container &&
				value.offset <= comment.start &&
				comment.end <= value.offset + value.length
			)
				return this.attach(
					comment,
					value,
					[...path, inside.segment],
					all
				);
			return this.add([...path, inside.segment], "leading", comment);
		}
		const before = children.filter((child) => child.end <= comment.start);
		const after = children.filter((child) => child.start >= comment.end);
		const prev = before[before.length - 1];
		const next = after[0];
		const gap = this.blanked(
			prev?.end ?? node.offset + 1,
			comment.start,
			all
		);
		const lineEnd = this.text.indexOf("\n", comment.end);
		const rest = this.blanked(
			comment.end,
			lineEnd === -1 ? this.text.length : lineEnd,
			all
		);
		const endsLine =
			ONLY_A_COMMA.test(rest) &&
			(next === undefined || !this.sharesLine(comment, next));
		if (prev && ONLY_A_COMMA.test(gap) && endsLine)
			return this.add([...path, prev.segment], "trailing", comment);
		if (!prev && /^[ \t\r]*$/.test(gap) && endsLine)
			return this.add(path, "opening", comment);
		if (next) return this.add([...path, next.segment], "leading", comment);
		this.add(path, "closing", comment);
	}

	private sharesLine(comment: Found, next: Located): boolean {
		return !this.text.slice(comment.end, next.start).includes("\n");
	}

	private blanked(from: number, to: number, all: readonly Found[]): string {
		let text = this.text.slice(from, to);
		for (const other of all) {
			if (other.end <= from || other.start >= to) continue;
			const start = Math.max(other.start, from) - from;
			const end = Math.min(other.end, to) - from;
			text =
				text.slice(0, start) +
				" ".repeat(end - start) +
				text.slice(end);
		}
		return text;
	}

	private add(path: JsoncPath, bucket: Bucket, comment: Found): void {
		const key = JsoncComments.key(path);
		const marks = this.marks.get(key) ?? {
			leading: [],
			trailing: [],
			opening: [],
			closing: [],
		};
		marks[bucket].push(this.linesOf(comment));
		this.marks.set(key, marks);
	}

	private linesOf({ start, end }: Found): string[] {
		const lineStart = this.text.lastIndexOf("\n", start - 1) + 1;
		const base = /^[ \t]*/.exec(this.text.slice(lineStart))?.[0] ?? "";
		return this.text
			.slice(start, end)
			.split(/\r?\n/)
			.map((line, at) =>
				at > 0 && line.startsWith(base) ? line.slice(base.length) : line
			);
	}

	private static valueOf(node: Node): Node {
		return node.type === "property" ? (node.children?.[1] ?? node) : node;
	}

	private static children(node: Node): Located[] {
		if (node.type === "object")
			return (node.children ?? []).map((property) => ({
				start: property.offset,
				end: property.offset + property.length,
				node: property,
				segment: String(property.children?.[0]?.value),
			}));
		if (node.type === "array")
			return (node.children ?? []).map((item, at) => ({
				start: item.offset,
				end: item.offset + item.length,
				node: item,
				segment: at,
			}));
		return [];
	}
}
