export function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const substitution =
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
			current[j] = Math.min(
				substitution,
				previous[j] + 1,
				current[j - 1] + 1
			);
		}
		previous = current;
	}
	return previous[b.length];
}

export function findClosest(
	input: string,
	candidates: readonly string[]
): string | undefined {
	const target = input.toLowerCase();
	const maxDistance = Math.max(1, Math.floor(input.length / 3));
	let best: string | undefined;
	let bestDistance = maxDistance + 1;
	for (const candidate of candidates) {
		const distance = editDistance(target, candidate.toLowerCase());
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}
