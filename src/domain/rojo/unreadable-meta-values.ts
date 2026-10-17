import { JsoncNode } from "../../base/jsonc.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

/** The lengths of the lists of numbers Rojo reads as a value: a vector, a color, a rectangle and a matrix. */
const NUMBER_LIST_LENGTHS = new Set([2, 3, 4, 12]);

const isReadable = (node: JsoncNode): boolean => {
	switch (node.kind) {
		case "boolean":
		case "string":
		case "number":
			return true;
		case "array":
			return (
				node.items.every(({ kind }) => kind === "string") ||
				(node.items.every(({ kind }) => kind === "number") &&
					NUMBER_LIST_LENGTHS.has(node.items.length))
			);
		case "object":
			return node.properties.length <= 1;
		default:
			return false;
	}
};

/** The values of a meta file's `properties` and `attributes` that Rojo refuses to read, one error each at the value. */
export function unreadableMetaValues(
	root: Extract<JsoncNode, { kind: "object" }>,
	file: string
): Diagnostic[] {
	return root.properties
		.filter(({ name }) => name === "properties" || name === "attributes")
		.flatMap(({ name: table, value }) =>
			value.kind === "object"
				? value.properties
						.filter((property) => !isReadable(property.value))
						.map(({ name, value: found }) =>
							errorDiagnostic(
								"meta.unreadableValue",
								{
									resource: file,
									position: {
										line: found.line,
										column: found.column,
									},
								},
								`"${table}.${name}": Rojo can't read this value, so it refuses this meta. Write a boolean, a number, a string, a list of numbers (2, 3, 4 or 12), a list of strings, or a { "Type": value } pair.`
							)
						)
				: []
		);
}
