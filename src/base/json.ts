import { isObject } from "./objects.js";

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

export function formatJsonFile(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

export function formatJsonDocument(value: unknown): string {
	return JSON.stringify(value);
}
