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

export function sortObject<T>(obj: T): T {
	if (!isObject(obj)) {
		return obj;
	}

	return Object.keys(obj)
		.sort()
		.reduce((acc: Record<string, unknown>, key: string) => {
			setOwn(acc, key, sortObject(getOwn(obj, key)));
			return acc;
		}, {}) as T;
}

/** Deeply merges objects into a new one, leaving the originals alone. */
export function mergeDeep<T = Record<string, unknown>>(
	...objects: unknown[]
): T {
	return objects.reduce((acc: Record<string, unknown>, obj) => {
		if (!isObject(obj)) return acc;

		for (const key of Object.keys(obj)) {
			const accVal = getOwn(acc, key);
			const objVal = getOwn(obj, key);

			if (isObject(accVal) && isObject(objVal)) {
				setOwn(acc, key, mergeDeep({ ...accVal }, objVal));
			} else if (isObject(objVal)) {
				setOwn(acc, key, mergeDeep({}, objVal));
			} else {
				setOwn(acc, key, objVal);
			}
		}
		return acc;
	}, {}) as T;
}
