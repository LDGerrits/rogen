export function isObject(obj: unknown): obj is Record<string, unknown> {
	return (
		typeof obj === "object" &&
		obj !== null &&
		!Array.isArray(obj) &&
		!(obj instanceof RegExp) &&
		!(obj instanceof Date)
	);
}

export function sortObject<T>(obj: T): T {
	if (!isObject(obj)) {
		return obj;
	}

	return Object.keys(obj)
		.sort()
		.reduce((acc: Record<string, unknown>, key: string) => {
			acc[key] = sortObject(obj[key]);
			return acc;
		}, {}) as T;
}

/**
 * Deeply merges objects into a new object without mutation of the original objects.
 */
export function mergeDeep<T = Record<string, unknown>>(
	...objects: unknown[]
): T {
	return objects.reduce((acc: Record<string, unknown>, obj) => {
		if (!isObject(obj)) return acc;

		for (const key of Object.keys(obj)) {
			const accVal = acc[key];
			const objVal = obj[key];

			if (isObject(accVal) && isObject(objVal)) {
				acc[key] = mergeDeep({ ...accVal }, objVal);
			} else if (isObject(objVal)) {
				acc[key] = mergeDeep({}, objVal);
			} else {
				acc[key] = objVal;
			}
		}
		return acc;
	}, {}) as T;
}
