export type JSONSchemaType =
	"string" | "number" | "boolean" | "null" | "array" | "object";

export interface JSONSchema {
	type?: JSONSchemaType | JSONSchemaType[];
	default?: unknown;
	description?: string;
	enum?: unknown[];
	examples?: unknown[];
	pattern?: string;
	propertyNames?: JSONSchema;
	properties?: Record<string, JSONSchema>;
	items?: JSONSchema;
	additionalProperties?: boolean | JSONSchema;
}
