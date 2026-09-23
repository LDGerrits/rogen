import {
	Node,
	ParseError,
	ParseErrorCode,
	getNodeValue,
	parseTree,
	printParseErrorCode,
} from "jsonc-parser";
import { Result, err, ok } from "./result.js";

const BYTE_ORDER_MARK = 0xfeff;

export interface JsoncPosition {
	readonly line: number;
	readonly column: number;
}

export interface JsoncError extends JsoncPosition {
	readonly message: string;
}

export interface JsoncProperty extends JsoncPosition {
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

export interface JsoncDocument {
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

export function parseJsonc(text: string): JsoncDocument {
	const source =
		text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
	const errors: ParseError[] = [];

	let tree: Node | undefined;
	let value: unknown;
	let root: JsoncNode | undefined;
	try {
		tree = parseTree(source, errors, { allowTrailingComma: true });
		if (tree) {
			value = getNodeValue(tree);
			root = toJsoncNode(tree, source);
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
		errors: errors.map((error) => ({
			message: describeSyntaxError(error.error),
			...positionAt(source, error.offset),
		})),
	};
}

function toJsoncNode(node: Node, source: string): JsoncNode {
	const position = positionAt(source, node.offset);
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
						...positionAt(source, key.offset),
						value: toJsoncNode(value, source),
					};
				}),
			};
		case "array":
			return {
				...position,
				kind: "array",
				items: (node.children ?? []).map((item) =>
					toJsoncNode(item, source)
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

function positionAt(text: string, offset: number): JsoncPosition {
	const lines = text.slice(0, offset).split("\n");
	return { line: lines.length, column: lines[lines.length - 1].length + 1 };
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
