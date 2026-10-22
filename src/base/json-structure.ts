type JsonType = "string" | "number" | "boolean" | "null" | "array" | "object";

/** The types a JSON document may hold, field by field. */
export interface JsonStructure {
	type?: JsonType | JsonType[];
	properties?: Record<string, JsonStructure>;
	items?: JsonStructure;
	additionalProperties?: boolean | JsonStructure;
}
