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

/** Orders by code point, which is the order of the UTF-8 bytes, unlike `localeCompare`, so it agrees on every machine. */
export function compareStrings(a: string, b: string): number {
	const first = [...a];
	const second = [...b];
	const shared = Math.min(first.length, second.length);
	for (let at = 0; at < shared; at++) {
		const difference =
			first[at].codePointAt(0)! - second[at].codePointAt(0)!;
		if (difference !== 0) return difference < 0 ? -1 : 1;
	}
	return first.length < second.length
		? -1
		: first.length > second.length
			? 1
			: 0;
}
