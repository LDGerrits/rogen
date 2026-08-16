import { isObject, sortObject } from "./object.js";

/**
 * Serializes object into JSON in alphabetical order.
 */
export function stableStringify(obj: unknown): string {
	const sorted = sortObject(obj);
	return JSON.stringify(sorted, null, 2);
}

/**
 * A safe `JSON.Stringify` that breaks apart any circular references.
 */
export function safeStringify(obj: unknown): string {
	const seen = new Set<unknown>();
	return JSON.stringify(obj, (_, value) => {
		if (typeof value === "bigint") {
			return `[BigInt ${value.toString()}]`;
		}

		if (isObject(value) || Array.isArray(value)) {
			if (seen.has(value)) {
				return "[Circular]";
			}
			seen.add(value);
		}

		return value;
	});
}
