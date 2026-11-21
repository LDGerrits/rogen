export type OutputShape =
	| { readonly kind: "string" | "integer" | "boolean" | "null" }
	| { readonly kind: "enum"; readonly values: readonly string[] }
	| { readonly kind: "array"; readonly of: OutputShape }
	| { readonly kind: "record"; readonly of: OutputShape }
	| {
			readonly kind: "object";
			readonly fields: Readonly<
				Record<string, OutputShape | OptionalKey>
			>;
	  }
	| { readonly kind: "union"; readonly of: readonly OutputShape[] }
	| {
			readonly kind: "named";
			readonly name: string;
			readonly shape: OutputShape;
	  };

export interface OptionalKey {
	readonly kind: "optional";
	readonly of: OutputShape;
}

export interface OutputDeclaration {
	readonly document?: OutputShape;
	readonly lines?: OutputShape;
}

export const OutputShape = {
	string: { kind: "string" },
	integer: { kind: "integer" },
	boolean: { kind: "boolean" },
	null: { kind: "null" },

	enum: (...values: readonly string[]): OutputShape => ({
		kind: "enum",
		values,
	}),

	array: (of: OutputShape): OutputShape => ({ kind: "array", of }),

	record: (of: OutputShape): OutputShape => ({ kind: "record", of }),

	object: (
		fields: Readonly<Record<string, OutputShape | OptionalKey>>
	): OutputShape => ({ kind: "object", fields }),

	optional: (of: OutputShape): OptionalKey => ({ kind: "optional", of }),

	union: (...of: readonly OutputShape[]): OutputShape => ({
		kind: "union",
		of,
	}),

	nullable: (of: OutputShape): OutputShape => ({
		kind: "union",
		of: [of, { kind: "null" }],
	}),

	named: (name: string, shape: OutputShape): OutputShape => ({
		kind: "named",
		name,
		shape,
	}),
} as const;

export function namedShapes(
	shape: OutputShape,
	found = new Map<string, OutputShape>()
): ReadonlyMap<string, OutputShape> {
	switch (shape.kind) {
		case "named": {
			const known = found.get(shape.name);
			if (known === undefined) {
				found.set(shape.name, shape.shape);
				namedShapes(shape.shape, found);
			} else if (known !== shape.shape) {
				throw new Error(
					`Two different output shapes are named ${shape.name}.`
				);
			}
			break;
		}
		case "array":
		case "record":
			namedShapes(shape.of, found);
			break;
		case "union":
			shape.of.forEach((item) => namedShapes(item, found));
			break;
		case "object":
			for (const field of Object.values(shape.fields))
				namedShapes(
					field.kind === "optional" ? field.of : field,
					found
				);
			break;
		default:
	}
	return found;
}
