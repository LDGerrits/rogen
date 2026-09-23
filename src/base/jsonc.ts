import {
	ParseError,
	ParseErrorCode,
	getNodeValue,
	parseTree,
	printParseErrorCode,
} from "jsonc-parser";

export interface JsoncPosition {
	readonly line: number;
	readonly column: number;
}

export interface JsoncError extends JsoncPosition {
	readonly message: string;
}

export interface JsoncProperty extends JsoncPosition {
	readonly name: string;
}

export interface JsoncDocument {
	readonly value: unknown;
	readonly errors: readonly JsoncError[];
	readonly rootProperties: readonly JsoncProperty[];
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
	const source = text.startsWith("﻿") ? text.slice(1) : text;
	const errors: ParseError[] = [];
	const root = parseTree(source, errors, { allowTrailingComma: true });

	const rootProperties: JsoncProperty[] = [];
	if (root?.type === "object") {
		for (const property of root.children ?? []) {
			const key = property.children?.[0];
			if (key) {
				rootProperties.push({
					name: String(key.value),
					...positionAt(source, key.offset),
				});
			}
		}
	}

	return {
		value: root ? getNodeValue(root) : undefined,
		errors: errors.map((error) => ({
			message: describeSyntaxError(error.error),
			...positionAt(source, error.offset),
		})),
		rootProperties,
	};
}

function describeSyntaxError(code: ParseErrorCode): string {
	return SYNTAX_MESSAGES[printParseErrorCode(code)] ?? "syntax error";
}

function positionAt(text: string, offset: number): JsoncPosition {
	const lines = text.slice(0, offset).split("\n");
	return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}
