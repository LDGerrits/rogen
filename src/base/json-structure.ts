type JsonType = "string" | "number" | "boolean" | "null" | "array" | "object";

/** The types a JSON document may hold, field by field. */
export interface JsonStructure {
	type?: JsonType | JsonType[];
	properties?: Record<string, JsonStructure>;
	items?: JsonStructure;
	additionalProperties?: boolean | JsonStructure;
	/** A number that must be a whole number from 0 to `max`. */
	whole?: { readonly max: number };
	/** A string that must be an IPv4 or IPv6 address. */
	ipAddress?: boolean;
	/** Said after the problem a value has with `whole` or `ipAddress`. */
	hint?: string;
}
