import {
	Node,
	ParseError,
	ParseErrorCode,
	applyEdits,
	findNodeAtLocation,
	getNodeValue,
	modify,
	parseTree,
	printParseErrorCode,
	visit,
} from "jsonc-parser";
import { Result, err, ok } from "./result.js";

const BYTE_ORDER_MARK = 0xfeff;

interface JsoncPosition {
	readonly line: number;
	readonly column: number;
}

interface JsoncError extends JsoncPosition {
	readonly message: string;
}

interface JsoncProperty extends JsoncPosition {
	readonly name: string;
	readonly value: JsoncNode;
}

export type JsoncNode = JsoncPosition &
	(
		| {
				readonly kind: "object";
				readonly properties: readonly JsoncProperty[];
		  }
		| { readonly kind: "array"; readonly items: readonly JsoncNode[] }
		| { readonly kind: "string" | "number" | "boolean" | "null" }
	);

interface JsoncDocument {
	readonly root: JsoncNode | undefined;
	readonly value: unknown;
	readonly errors: readonly JsoncError[];
}

const SYNTAX_MESSAGES: Record<string, string> = {
	InvalidSymbol: "unexpected character",
	InvalidNumberFormat: "malformed number",
	PropertyNameExpected: "expected a property name",
	ValueExpected: "expected a value",
	ColonExpected: "expected ':'",
	CommaExpected: "expected ','",
	CloseBraceExpected: "expected '}'",
	CloseBracketExpected: "expected ']'",
	EndOfFileExpected: "unexpected content after the end of the document",
	InvalidCommentToken: "unexpected comment",
	UnexpectedEndOfComment: "unterminated comment",
	UnexpectedEndOfString: "unterminated string",
	UnexpectedEndOfNumber: "unterminated number",
	InvalidUnicode: "invalid unicode escape",
	InvalidEscapeCharacter: "invalid escape character",
	InvalidCharacter: "invalid character",
};

/** A value with the place it has in the text, so a caller can copy it as written. */
export interface JsoncSpan {
	/** Offsets into `text` of the parsed document, from the first character of the value to just after its last. */
	readonly start: number;
	readonly end: number;
	readonly value: unknown;
	readonly properties?: readonly {
		readonly name: string;
		/** The offset of the key, where the entry starts. */
		readonly start: number;
		readonly value: JsoncSpan;
	}[];
}

/** The document without a byte order mark, which the offsets of `root` index, and its root value. `undefined` when the text isn't valid. */
export function parseJsoncSpans(
	text: string
): { text: string; root: JsoncSpan } | undefined {
	const source =
		text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
	const errors: ParseError[] = [];
	const tree = parseTree(source, errors, { allowTrailingComma: true });
	return tree && errors.length === 0
		? { text: source, root: toSpan(tree) }
		: undefined;
}

function toSpan(node: Node): JsoncSpan {
	const span = {
		start: node.offset,
		end: node.offset + node.length,
		value: getNodeValue(node),
	};
	if (node.type !== "object") return span;
	return {
		...span,
		properties: (node.children ?? []).flatMap((property) => {
			const [key, value] = property.children ?? [];
			return key && value
				? [
						{
							name: String(key.value),
							start: property.offset,
							value: toSpan(value),
						},
					]
				: [];
		}),
	};
}

/** Whether the text holds a line or block comment outside its strings. */
export function hasComments(text: string): boolean {
	let found = false;
	visit(
		text,
		{
			onComment: () => {
				found = true;
			},
		},
		{ allowTrailingComma: true }
	);
	return found;
}

export function parseJsonc(text: string): JsoncDocument {
	const source =
		text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
	const errors: ParseError[] = [];
	const positionAt = positionsIn(source);

	let tree: Node | undefined;
	let value: unknown;
	let root: JsoncNode | undefined;
	try {
		tree = parseTree(source, errors, { allowTrailingComma: true });
		if (tree) {
			value = getNodeValue(tree);
			root = toJsoncNode(tree, positionAt);
		}
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		return {
			root: undefined,
			value: undefined,
			errors: [
				{
					message: "the document is nested too deeply",
					line: 1,
					column: 1,
				},
			],
		};
	}

	return {
		root,
		value,
		errors: withoutRepeats(
			errors.map((error) => ({
				message: describeSyntaxError(error.error),
				...positionAt(error.offset),
			}))
		),
	};
}

/** The parser reports one close-brace error per object still open at the end of the text. */
function withoutRepeats(errors: readonly JsoncError[]): JsoncError[] {
	const seen = new Set<string>();
	return errors.filter(({ message, line, column }) => {
		const key = `${line}:${column}:${message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function toJsoncNode(node: Node, positionAt: PositionAt): JsoncNode {
	const position = positionAt(node.offset);
	switch (node.type) {
		case "object":
			return {
				...position,
				kind: "object",
				properties: (node.children ?? []).flatMap((property) => {
					const [key, value] = property.children ?? [];
					if (!key || !value) return [];
					return {
						name: String(key.value),
						...positionAt(key.offset),
						value: toJsoncNode(value, positionAt),
					};
				}),
			};
		case "array":
			return {
				...position,
				kind: "array",
				items: (node.children ?? []).map((item) =>
					toJsoncNode(item, positionAt)
				),
			};
		case "string":
		case "number":
		case "boolean":
		case "null":
			return { ...position, kind: node.type };
		default:
			throw new Error(`Unexpected JSONC node type "${node.type}".`);
	}
}

function describeSyntaxError(code: ParseErrorCode): string {
	return SYNTAX_MESSAGES[printParseErrorCode(code)] ?? "syntax error";
}

type PositionAt = (offset: number) => JsoncPosition;

function positionsIn(text: string): PositionAt {
	const lineStarts = [0];
	for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
		lineStarts.push(i + 1);
	return (offset) => {
		let low = 0;
		let high = lineStarts.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if (lineStarts[middle] <= offset) low = middle;
			else high = middle - 1;
		}
		return { line: low + 1, column: offset - lineStarts[low] + 1 };
	};
}

export function parse(text: string): Result<unknown, Error> {
	const { root, value, errors } = parseJsonc(text);
	const [first] = errors;
	if (first) {
		return err(
			new Error(
				`invalid JSONC at ${first.line}:${first.column}: ${first.message}.`
			)
		);
	}
	if (!root) return err(new Error("invalid JSONC: the document is empty."));
	return ok(value);
}

/** The indentation and line ending a document is written with, to write an edit the same way. */
function formattingOf(text: string) {
	const indent = /^([ \t]+)["}\]]/m.exec(text)?.[1] ?? "  ";
	return {
		insertSpaces: !indent.startsWith("\t"),
		tabSize: indent.startsWith("\t") ? 1 : indent.length,
		eol: text.includes("\r\n") ? "\r\n" : "\n",
	};
}

/** `text` with the value at `at` set, or removed when `value` is undefined; comments and the rest of the formatting stay, and an object written on one line, or a value in one, stays on one line. */
export function setJsoncValue(
	text: string,
	at: readonly string[],
	value: unknown
): string {
	const edits = modify(text, [...at], value, {
		formattingOptions: formattingOf(text),
	});
	const tree = parseTree(text, [], { allowTrailingComma: true });
	const replaced = tree && findNodeAtLocation(tree, [...at]);
	const oneLine =
		(tree !== undefined && writtenOnOneLine(text, tree, at.slice(0, -1))) ||
		((replaced?.type === "object" || replaced?.type === "array") &&
			onOneLineIn(text, replaced));
	return applyEdits(
		text,
		oneLine
			? edits.map((edit) => ({
					...edit,
					content: onOneLine(edit.content),
				}))
			: edits
	);
}

const onOneLineIn = (text: string, node: Node): boolean =>
	!text.slice(node.offset, node.offset + node.length).includes("\n");

/** Whether the deepest object of `at` the text has is written on one line. */
function writtenOnOneLine(
	text: string,
	tree: Node,
	at: readonly string[]
): boolean {
	for (let path = [...at]; ; path = path.slice(0, -1)) {
		const node = findNodeAtLocation(tree, path);
		if (node) return onOneLineIn(text, node);
		if (path.length === 0) return false;
	}
}

const onOneLine = (text: string) =>
	text
		.replace(/\[\s*\n\s*/g, "[")
		.replace(/\s*\n\s*\]/g, "]")
		.replace(/\s*\n\s*/g, " ");
