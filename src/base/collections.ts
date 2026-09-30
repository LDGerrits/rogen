export function groupBy<T, K>(
	items: Iterable<T>,
	keyOf: (item: T) => K
): Map<K, T[]>;
export function groupBy<T, K, V>(
	items: Iterable<T>,
	keyOf: (item: T) => K,
	valueOf: (item: T) => V
): Map<K, V[]>;
export function groupBy<T, K, V>(
	items: Iterable<T>,
	keyOf: (item: T) => K,
	valueOf: (item: T) => V = (item) => item as unknown as V
): Map<K, V[]> {
	const groups = new Map<K, V[]>();
	for (const item of items) {
		const key = keyOf(item);
		const group = groups.get(key);
		if (group) group.push(valueOf(item));
		else groups.set(key, [valueOf(item)]);
	}
	return groups;
}

/** Orders by code point, unlike `localeCompare`, so it agrees on every machine. */
export function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
