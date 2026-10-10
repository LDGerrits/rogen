import { isObject, sortObject } from "./objects.js";

/** `obj` as JSON with its keys in alphabetical order. */
export function stableStringify(obj: unknown): string {
	const sorted = sortObject(obj);
	return JSON.stringify(sorted, null, 2);
}

/** `JSON.stringify` that breaks apart circular references. */
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

/** Tab-indented JSON with a trailing newline, for files people edit by hand. */
export function formatJsonFile(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

/** Two-space JSON without a trailing newline, for a program to read from stdout. */
export function formatJsonDocument(value: unknown): string {
	return JSON.stringify(value, null, 2);
}
