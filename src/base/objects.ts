export function isObject(obj: unknown): obj is Record<string, unknown> {
	return (
		typeof obj === "object" &&
		obj !== null &&
		!Array.isArray(obj) &&
		!(obj instanceof RegExp) &&
		!(obj instanceof Date)
	);
}

/** Sets `key` on `target` as an own property, so a key such as `__proto__` is kept as data instead of reaching the prototype. */
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

/** The own property `key` of `source`; what the prototype chain holds under the name does not count. */
export function getOwn<T>(
	source: Readonly<Record<string, T>>,
	key: string
): T | undefined {
	return Object.hasOwn(source, key) ? source[key] : undefined;
}

/** `base` with `patch` applied as JSON merge patch does: objects merge by key, anything else replaces, and `null` removes the key. Lists replace. Leaves both alone. */
export function mergePatch(
	base: Readonly<Record<string, unknown>>,
	patch: Readonly<Record<string, unknown>>
): Record<string, unknown> {
	const merged = structuredClone(base) as Record<string, unknown>;
	applyPatch(merged, patch);
	return merged;
}

/** Applies `patch` to `target`, which is the caller's own copy. */
function applyPatch(
	target: Record<string, unknown>,
	patch: Readonly<Record<string, unknown>>
): void {
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) {
			delete target[key];
			continue;
		}
		if (!isObject(value)) {
			setOwn(target, key, structuredClone(value));
			continue;
		}
		const existing = getOwn(target, key);
		const merged = isObject(existing) ? existing : {};
		applyPatch(merged, value);
		setOwn(target, key, merged);
	}
}
