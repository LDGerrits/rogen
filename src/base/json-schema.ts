export type JSONSchemaType =
	"string" | "number" | "boolean" | "null" | "array" | "object";

export interface JSONSchema {
	type?: JSONSchemaType | JSONSchemaType[];
	default?: unknown;
	description?: string;
	enum?: unknown[];
	properties?: Record<string, JSONSchema>;
	items?: JSONSchema;
	additionalProperties?: boolean | JSONSchema;
}
