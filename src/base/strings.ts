export function capitalized(text: string): string {
	return text[0].toUpperCase() + text.slice(1);
}

/** The first `limit` of `items` joined by commas, then an ellipsis when there are more. */
export function listLimited(items: readonly string[], limit: number): string {
	const listed = items.slice(0, limit).join(", ");
	return items.length > limit ? `${listed}, …` : listed;
}

/** `count` and `noun`, adding an s unless there is one: `1 file`, `3 files`. */
export function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Edits between `a` and `b`, counting two swapped neighbours as one. */
export function editDistance(a: string, b: string): number {
	let twoBack: number[] = [];
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + cost
			);
			if (
				i > 1 &&
				j > 1 &&
				a[i - 1] === b[j - 2] &&
				a[i - 2] === b[j - 1]
			)
				current[j] = Math.min(current[j], twoBack[j - 2] + 1);
		}
		twoBack = previous;
		previous = current;
	}
	return previous[b.length];
}

/** The candidate `word` most likely misspells, judged as TypeScript does: up to two edits in five letters, ignoring case. */
export function closestMatch(
	word: string,
	candidates: Iterable<string>
): string | undefined {
	return closestMatches(word, candidates)[0];
}

/** Every candidate as close to `word` as the closest one, in the order given, judged as `closestMatch` judges. */
export function closestMatches(
	word: string,
	candidates: Iterable<string>
): string[] {
	const lower = word.toLowerCase();
	let best: string[] = [];
	let bestDistance = Math.floor(word.length * 0.4) + 1;
	for (const candidate of candidates) {
		const distance = editDistance(lower, candidate.toLowerCase());
		if (distance < bestDistance) {
			best = [candidate];
			bestDistance = distance;
		} else if (distance === bestDistance && best.length > 0) {
			best.push(candidate);
		}
	}
	return best;
}

/** `a`, `a and b`, `a, b and c`. */
export function joinedWithAnd(items: readonly string[]): string {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function joinedWithOr(items: readonly string[]): string {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
