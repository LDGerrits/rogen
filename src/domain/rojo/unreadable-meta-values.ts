import { JsoncNode } from "../../base/jsonc.js";
import { getOwn, isObject } from "../../base/objects.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { PropertyValues } from "./property-values.js";

const TABLES = ["properties", "attributes"];

const lastNamed = (node: JsoncNode | undefined, name: string) =>
	node?.kind === "object"
		? [...node.properties]
				.reverse()
				.find((property) => property.name === name)
		: undefined;

/** The values of a meta file's `properties` and `attributes` that Rojo refuses to read, one error each at the value. */
export function unreadableMetaValues(
	root: Extract<JsoncNode, { kind: "object" }>,
	value: Readonly<Record<string, unknown>>,
	file: string
): Diagnostic[] {
	return TABLES.flatMap((table) => {
		const values = getOwn(value, table);
		if (!isObject(values)) return [];
		const node = lastNamed(root, table)?.value;
		return Object.entries(values)
			.filter(([, found]) => !PropertyValues.isReadable(found))
			.map(([name]) => {
				const at = lastNamed(node, name)?.value ?? root;
				return errorDiagnostic(
					"meta.unreadableValue",
					{
						resource: file,
						position: { line: at.line, column: at.column },
					},
					`"${table}.${name}": Rojo can't read this value, so it refuses this meta. ${PropertyValues.READABLE_HINT}`
				);
			});
	});
}
