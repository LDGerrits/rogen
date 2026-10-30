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
	const shared = Math.min(a.length, b.length);
	for (let at = 0; at < shared; at++) {
		const first = a.charCodeAt(at);
		const second = b.charCodeAt(at);
		if (first !== second) {
			const difference = byCodePoint(first) - byCodePoint(second);
			return difference < 0 ? -1 : 1;
		}
	}
	return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

/** A UTF-16 code unit moved so that a surrogate, which stands for a code point past the basic plane, sorts after every other unit. */
function byCodePoint(unit: number): number {
	return unit >= 0xe000
		? unit - 0x800
		: unit >= 0xd800
			? unit + 0x2000
			: unit;
}
