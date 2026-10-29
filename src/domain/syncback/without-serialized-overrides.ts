import { isObject, isSameJson } from "../../base/objects.js";
import { tryWith } from "../../base/result.js";

const isEmptyBinaryString = (value: unknown): boolean =>
	isObject(value) &&
	Object.keys(value).length === 1 &&
	value.BinaryString === "";

/** `holder` without the empty `SerializedOverrides` in its `key` map, and without the map when that leaves it empty. */
function strip(
	holder: Record<string, unknown>,
	key: string
): Record<string, unknown> {
	const properties = holder[key];
	if (!isObject(properties)) return holder;
	const kept = Object.fromEntries(
		Object.entries(properties).filter(
			([name, property]) =>
				name !== "SerializedOverrides" || !isEmptyBinaryString(property)
		)
	);
	return Object.fromEntries(
		Object.entries(holder).flatMap(([name, value]) =>
			name !== key
				? [[name, value]]
				: Object.keys(kept).length > 0
					? [[name, kept]]
					: []
		)
	);
}

/** A project tree without the empty `SerializedOverrides` Studio saves on every instance, which Rojo doesn't know and so writes as a change. */
export function treeWithoutSerializedOverrides<T>(node: T): T {
	if (!isObject(node)) return node;
	return Object.fromEntries(
		Object.entries(strip(node, "$properties")).map(([key, child]) => [
			key,
			key.startsWith("$") ? child : treeWithoutSerializedOverrides(child),
		])
	) as T;
}

/** A meta or model file without the empty `SerializedOverrides` Studio saves, in it and in each of its `children`. */
export function withoutSerializedOverrides<T>(file: T): T {
	if (!isObject(file)) return file;
	const stripped = strip(file, "properties");
	const { children } = stripped;
	return (
		Array.isArray(children)
			? {
					...stripped,
					children: children.map((child) =>
						withoutSerializedOverrides<unknown>(child)
					),
				}
			: stripped
	) as T;
}

/** Whether a meta or model file Rojo wrote, new when `before` is undefined, changes nothing but an empty `SerializedOverrides`. */
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
