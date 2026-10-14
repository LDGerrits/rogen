import { OutputDeclaration, OutputShape, namedShapes } from "./output-shape.js";

const WORDS = {
	string: "string",
	integer: "int",
	boolean: "bool",
	null: "null",
} as const;

function write(shape: OutputShape): string {
	switch (shape.kind) {
		case "string":
		case "integer":
		case "boolean":
		case "null":
			return WORDS[shape.kind];
		case "enum":
			return shape.values.map((value) => JSON.stringify(value)).join("|");
		case "array":
			return `[${write(shape.of)}]`;
		case "record":
			return `{*:${write(shape.of)}}`;
		case "union":
			return shape.of.map(write).join("|");
		case "named":
			return shape.name;
		case "object":
			return `{${Object.entries(shape.fields)
				.map(([key, field]) =>
					field.kind === "optional"
						? `${key}?:${write(field.of)}`
						: `${key}:${write(field)}`
				)
				.join(",")}}`;
	}
}

/** A shape in the compact text an agent reads: `{configs:[{config:string,outcome:"wrote"|"unchanged"}]}`, with a shape that has a name written as the name. */
export const OutputNotation = {
	of: write,

	/** What a declaration prints, in the notation. */
	describe(declaration: OutputDeclaration): {
		readonly document?: string;
		readonly lines?: string;
	} {
		return {
			...(declaration.document && {
				document: write(declaration.document),
			}),
			...(declaration.lines && { lines: write(declaration.lines) }),
		};
	},

	/** Each named shape the declaration reaches, and those of `others`, written out once. */
	shapesOf(
		declaration: OutputDeclaration,
		...others: readonly OutputShape[]
	): Record<string, string> {
		const found = new Map<string, OutputShape>();
		for (const shape of [
			declaration.document,
			declaration.lines,
			...others,
		])
			if (shape) namedShapes(shape, found);
		return Object.fromEntries(
			[...found].map(([name, shape]) => [name, write(shape)])
		);
	},
} as const;
