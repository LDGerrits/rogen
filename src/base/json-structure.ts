type JsonType = "string" | "number" | "boolean" | "null" | "array" | "object";

export interface JsonStructure {
	type?: JsonType | JsonType[];
	properties?: Record<string, JsonStructure>;
	items?: JsonStructure;
	additionalProperties?: boolean | JsonStructure;
	whole?: { readonly max: number };
	ipAddress?: boolean;
	hint?: string;
}
