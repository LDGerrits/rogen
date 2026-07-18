import { sortObject } from "./object.js";

/**
 * Serializes object into JSON in alphabetical order.
 */
export function stableStringify(obj: unknown): string {
	const sorted = sortObject(obj);
	return JSON.stringify(sorted, null, 2);
}
