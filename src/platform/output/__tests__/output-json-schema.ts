import { OutputShape, namedShapes } from "../output-shape.js";

type Schema = Record<string, unknown>;

function convert(shape: OutputShape): Schema {
	switch (shape.kind) {
		case "string":
		case "boolean":
		case "integer":
		case "null":
			return { type: shape.kind };
		case "enum":
			return { enum: [...shape.values] };
		case "array":
			return { type: "array", items: convert(shape.of) };
		case "record":
			return {
				type: "object",
				additionalProperties: convert(shape.of),
			};
		case "union":
			return { anyOf: shape.of.map(convert) };
		case "named":
			return { $ref: `#/$defs/${shape.name}` };
		case "object": {
			const entries = Object.entries(shape.fields);
			return {
				type: "object",
				properties: Object.fromEntries(
					entries.map(([key, field]) => [
						key,
						convert(field.kind === "optional" ? field.of : field),
					])
				),
				required: entries
					.filter(([, field]) => field.kind !== "optional")
					.map(([key]) => key),
				additionalProperties: false,
			};
		}
	}
}

/** The JSON Schema that any one of `shapes` satisfies, closed so that a key nobody declared fails it; the named shapes they reach are its `$defs`. */
export function outputJsonSchema(shapes: readonly OutputShape[]): Schema {
	const named = new Map<string, OutputShape>();
	shapes.forEach((shape) => namedShapes(shape, named));
	return {
		anyOf: shapes.map(convert),
		$defs: Object.fromEntries(
			[...named].map(([name, shape]) => [name, convert(shape)])
		),
	};
}
