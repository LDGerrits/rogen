/** The shape of a JSON document a command prints, declared once so that its text for agents and the schema tests check it against both come from it. */
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

/** A key an object may leave out. */
export interface OptionalKey {
	readonly kind: "optional";
	readonly of: OutputShape;
}

/** What a command prints with `--json`: one document, or one line per event for a command that runs until it is stopped. */
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

	/** An object whose keys are not known ahead, each holding `of`. */
	record: (of: OutputShape): OutputShape => ({ kind: "record", of }),

	object: (
		fields: Readonly<Record<string, OutputShape | OptionalKey>>
	): OutputShape => ({ kind: "object", fields }),

	/** A key of an object that is there only sometimes. */
	optional: (of: OutputShape): OptionalKey => ({ kind: "optional", of }),

	union: (...of: readonly OutputShape[]): OutputShape => ({
		kind: "union",
		of,
	}),

	nullable: (of: OutputShape): OutputShape => ({
		kind: "union",
		of: [of, { kind: "null" }],
	}),

	/** A shape written out once under its name wherever it is used, such as `Diagnostic`. */
	named: (name: string, shape: OutputShape): OutputShape => ({
		kind: "named",
		name,
		shape,
	}),
} as const;

/** The shapes in `shape`, by name, each reached once; two different shapes under one name are a mistake in a declaration. */
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
