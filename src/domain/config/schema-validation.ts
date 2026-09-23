import { JsoncNode } from "../../base/jsonc.js";
import { JSONSchema } from "../../base/json-schema.js";
import { Diagnostic, Diagnostics } from "../diagnostics/diagnostic.js";

const KIND_NAMES: Record<JsoncNode["kind"], string> = {
	object: "an object",
	array: "an array",
	string: "a string",
	number: "a number",
	boolean: "a boolean",
	null: "null",
};

export function validateNode(
	node: JsoncNode,
	schema: JSONSchema,
	file: string,
	path = ""
): Diagnostic[] {
	const location = (at: { line: number; column: number }) => ({
		file,
		line: at.line,
		column: at.column,
	});

	const expected = schema.type === undefined ? [] : [schema.type].flat();
	if (expected.length > 0 && !expected.includes(node.kind)) {
		return [
			Diagnostics.wrongType(
				location(node),
				path,
				expected.map((kind) => KIND_NAMES[kind]).join(" or "),
				KIND_NAMES[node.kind]
			),
		];
	}

	if (node.kind === "array" && schema.items) {
		const items = schema.items;
		return node.items.flatMap((item, index) =>
			validateNode(item, items, file, `${path}[${index}]`)
		);
	}

	if (node.kind !== "object") return [];

	return node.properties.flatMap((property) => {
		const propertyPath = path ? `${path}.${property.name}` : property.name;
		const known = schema.properties?.[property.name];
		if (known) {
			return validateNode(property.value, known, file, propertyPath);
		}
		if (schema.additionalProperties === false) {
			return [Diagnostics.unknownField(location(property), propertyPath)];
		}
		if (typeof schema.additionalProperties === "object") {
			return validateNode(
				property.value,
				schema.additionalProperties,
				file,
				propertyPath
			);
		}
		return [];
	});
}
