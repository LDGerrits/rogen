import { isObject, isSameJson } from "../../base/objects.js";
import { tryWith } from "../../base/result.js";

const PROPERTY_MAPS = new Set(["properties", "$properties"]);

const isEmpty = (value: unknown): boolean =>
	isObject(value) &&
	Object.keys(value).length === 1 &&
	value.BinaryString === "";

/** A project tree, meta or model file without the empty `SerializedOverrides` Studio saves on every instance, which Rojo doesn't know and so writes as a change. */
export function withoutSerializedOverrides<T>(value: T): T {
	if (Array.isArray(value))
		return value.map((item) =>
			withoutSerializedOverrides<unknown>(item)
		) as T;
	if (!isObject(value)) return value;
	const kept: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (PROPERTY_MAPS.has(key) && isObject(child)) {
			const properties = Object.fromEntries(
				Object.entries(child).filter(
					([name, property]) =>
						name !== "SerializedOverrides" || !isEmpty(property)
				)
			);
			if (Object.keys(properties).length > 0) kept[key] = properties;
			continue;
		}
		kept[key] = withoutSerializedOverrides(child);
	}
	return kept as T;
}

/** Whether a JSON file Rojo wrote, new when `before` is undefined, changes nothing but an empty `SerializedOverrides`. */
export function onlySerializedOverrides(
	before: string | undefined,
	after: string
): boolean {
	const parsed = tryWith(() => ({
		before: before === undefined ? {} : (JSON.parse(before) as unknown),
		after: JSON.parse(after) as unknown,
	}));
	return (
		parsed.isOk() &&
		!isSameJson(parsed.value.before, parsed.value.after) &&
		isSameJson(
			withoutSerializedOverrides(parsed.value.before),
			withoutSerializedOverrides(parsed.value.after)
		)
	);
}
