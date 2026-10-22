import { JsonStructure } from "../../base/json-structure.js";
import { JsoncNode, parseJsonc } from "../../base/jsonc.js";
import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../diagnostics/diagnostic.js";

/** What kind of file is read, which words its diagnostics: `config` gives `config.wrongType` and "a config must be a JSON object". */
interface JsoncDocumentKind {
	readonly codePrefix: string;
	/** The file as a sentence starts with it, article included. */
	readonly noun: string;
}

interface JsoncObject {
	readonly root: Extract<JsoncNode, { kind: "object" }>;
	readonly value: Record<string, unknown>;
}

const KIND_NAMES: Record<JsoncNode["kind"], string> = {
	object: "an object",
	array: "an array",
	string: "a string",
	number: "a number",
	boolean: "a boolean",
	null: "null",
};

/** Parses JSONC into a JSON object checked against a structure; every problem is a diagnostic. */
export class JsoncDocumentReader {
	constructor(private readonly kind: JsoncDocumentKind) {}

	read(
		text: string,
		file: string,
		structure: JsonStructure
	): Result<JsoncObject, Diagnostic[]> {
		const { root, value, errors } = parseJsonc(text);

		if (errors.length > 0) {
			return err(
				errors.map(({ message, line, column }) =>
					this.error(
						"invalidSyntax",
						{ resource: file, position: { line, column } },
						`invalid JSONC: ${message}.`
					)
				)
			);
		}

		if (root?.kind !== "object") {
			return err([
				this.error(
					"notAnObject",
					{ resource: file, position: { line: 1, column: 1 } },
					`${this.kind.noun} must be a JSON object.`
				),
			]);
		}

		const problems = this.validate(root, structure, file, "");
		return problems.length > 0
			? err(problems)
			: ok({ root, value: value as Record<string, unknown> });
	}

	private error(
		code: string,
		location: DiagnosticLocation,
		message: string
	): Diagnostic {
		return errorDiagnostic(
			`${this.kind.codePrefix}.${code}`,
			location,
			message
		);
	}

	private validate(
		node: JsoncNode,
		structure: JsonStructure,
		file: string,
		path: string
	): Diagnostic[] {
		const location = (at: { line: number; column: number }) => ({
			resource: file,
			position: { line: at.line, column: at.column },
		});

		const expected =
			structure.type === undefined ? [] : [structure.type].flat();
		if (expected.length > 0 && !expected.includes(node.kind)) {
			return [
				this.error(
					"wrongType",
					location(node),
					`"${path}": expected ${expected.map((kind) => KIND_NAMES[kind]).join(" or ")}, found ${KIND_NAMES[node.kind]}.`
				),
			];
		}

		if (node.kind === "array" && structure.items) {
			const items = structure.items;
			return node.items.flatMap((item, index) =>
				this.validate(item, items, file, `${path}[${index}]`)
			);
		}

		if (node.kind !== "object") return [];

		return node.properties.flatMap((property) => {
			const propertyPath = path
				? `${path}.${property.name}`
				: property.name;
			const known = Object.hasOwn(
				structure.properties ?? {},
				property.name
			)
				? structure.properties?.[property.name]
				: undefined;
			if (known) {
				return this.validate(property.value, known, file, propertyPath);
			}
			if (structure.additionalProperties === false) {
				const present = new Set(
					node.properties.map(({ name }) => name)
				);
				const suggestion = closestMatch(
					property.name,
					Object.keys(structure.properties ?? {}).filter(
						(name) => !present.has(name)
					)
				);
				const prefix = path ? `${path}.` : "";
				return [
					this.error(
						"unknownField",
						location(property),
						`unknown field "${propertyPath}".` +
							(suggestion
								? ` Did you mean "${prefix}${suggestion}"?`
								: "")
					),
				];
			}
			if (typeof structure.additionalProperties === "object") {
				return this.validate(
					property.value,
					structure.additionalProperties,
					file,
					propertyPath
				);
			}
			return [];
		});
	}
}
