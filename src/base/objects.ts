export function isObject(obj: unknown): obj is Record<string, unknown> {
	return (
		typeof obj === "object" &&
		obj !== null &&
		!Array.isArray(obj) &&
		!(obj instanceof RegExp) &&
		!(obj instanceof Date)
	);
}

/** Whether two JSON values are the same, whatever prototypes their objects have. */
export function isSameJson(a: unknown, b: unknown): boolean {
	if (Array.isArray(a))
		return (
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, at) => isSameJson(item, b[at]))
		);
	if (isObject(a)) {
		if (!isObject(b)) return false;
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every(
				(key) => Object.hasOwn(b, key) && isSameJson(a[key], b[key])
			)
		);
	}
	return Object.is(a, b);
}

/** Sets `key` as an own property, so `__proto__` stays data. */
export function setOwn<T>(
	target: Record<string, T>,
	key: string,
	value: T
): void {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

/** The own property `key` of `source`, ignoring the prototype chain. */
export function getOwn<T>(
	source: Readonly<Record<string, T>>,
	key: string
): T | undefined {
	return Object.hasOwn(source, key) ? source[key] : undefined;
}

/** `base` with `changes` merged in by key; lists and other values replace, and neither input changes. */
export function mergeByKey(
	base: Readonly<Record<string, unknown>>,
	changes: Readonly<Record<string, unknown>>
): Record<string, unknown> {
	const merged = structuredClone(base) as Record<string, unknown>;
	applyChanges(merged, changes);
	return merged;
}

function applyChanges(
	target: Record<string, unknown>,
	changes: Readonly<Record<string, unknown>>
): void {
	for (const [key, value] of Object.entries(changes)) {
		if (!isObject(value)) {
			setOwn(target, key, structuredClone(value));
			continue;
		}
		const existing = getOwn(target, key);
		const merged = isObject(existing) ? existing : {};
		applyChanges(merged, value);
		setOwn(target, key, merged);
	}
}
