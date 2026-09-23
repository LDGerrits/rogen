import {
	Node,
	ParseError,
	ParseErrorCode,
	printParseErrorCode,
	getNodeValue,
	parseTree,
} from "jsonc-parser";
import { Result, ok, err } from "../../base/result.js";
import { findClosest } from "../../base/edit-distance.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	ConfigRegistry,
	Extensions,
} from "../../platform/config/config-registry.js";
import { Diagnostic } from "../diagnostics/diagnostic.js";
import { createDiagnostic } from "../diagnostics/diagnostic-codes.js";
import { RogenConfig } from "./config.js";

export function parseConfig(
	text: string,
	fileName: string
): Result<RogenConfig, Diagnostic[]> {
	const errors: ParseError[] = [];
	const root = parseTree(text, errors, { allowTrailingComma: true });

	if (root?.type !== "object") {
		return err([createDiagnostic("RG1002", locate(text, fileName, 0))]);
	}

	if (errors.length > 0) {
		return err(
			errors.map((error) =>
				createDiagnostic(
					"RG1001",
					locate(text, fileName, error.offset),
					describeSyntaxError(error.error)
				)
			)
		);
	}

	const knownFields = Object.keys(
		Registry.as<ConfigRegistry>(Extensions.Config).getJsonSchema()
			.properties ?? {}
	);
	const diagnostics: Diagnostic[] = [];
	for (const property of root?.children ?? []) {
		const key = property.children?.[0] as Node;
		const name = key.value as string;
		if (knownFields.includes(name)) continue;
		diagnostics.push(
			createDiagnostic(
				"RG1004",
				locate(text, fileName, key.offset),
				name,
				findClosest(name, knownFields)
			)
		);
	}
	if (diagnostics.length > 0) return err(diagnostics);

	return ok(getNodeValue(root as Node) as RogenConfig);
}

const SYNTAX_ERRORS: Record<string, string> = {
	InvalidSymbol: "unexpected character",
	InvalidNumberFormat: "malformed number",
	PropertyNameExpected: "expected a property name",
	ValueExpected: "expected a value",
	ColonExpected: "expected ':'",
	CommaExpected: "expected ','",
	CloseBraceExpected: "expected '}'",
	CloseBracketExpected: "expected ']'",
	EndOfFileExpected: "unexpected content after the config",
	InvalidCommentToken: "unexpected comment",
	UnexpectedEndOfComment: "unterminated comment",
	UnexpectedEndOfString: "unterminated string",
	UnexpectedEndOfNumber: "unterminated number",
	InvalidUnicode: "invalid unicode escape",
	InvalidEscapeCharacter: "invalid escape character",
	InvalidCharacter: "invalid character",
};

function describeSyntaxError(code: ParseErrorCode): string {
	return SYNTAX_ERRORS[printParseErrorCode(code)] ?? "syntax error";
}

function locate(text: string, file: string, offset: number) {
	const before = text.slice(0, offset).split("\n");
	return {
		file,
		line: before.length,
		column: before[before.length - 1].length + 1,
	};
}
