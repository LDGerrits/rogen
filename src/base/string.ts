export function getClosestMatch(
	input: string,
	targets: string[],
	distanceThreshold: number
): string | null {
	let closest: string | null = null;
	let minDistance = Infinity;

	for (const target of targets) {
		const distance = levenshtein(input, target);
		if (distance < minDistance) {
			minDistance = distance;
			closest = target;
		}
	}

	return minDistance <= distanceThreshold ? closest : null;
}

export function levenshtein(a: string, b: string) {
	const an = a.length;
	const bn = b.length;
	if (an == 0) {
		return bn;
	}
	if (bn == 0) {
		return an;
	}
	const matrix = new Array<number[]>(bn + 1);
	for (let i = 0; i <= bn; ++i) {
		const row = (matrix[i] = new Array<number>(an + 1));
		row[0] = i;
	}
	const firstRow = matrix[0];
	for (let j = 1; j <= an; ++j) {
		firstRow![j] = j;
	}
	for (let i = 1; i <= bn; ++i) {
		for (let j = 1; j <= an; ++j) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				matrix[i]![j] = matrix[i - 1]![j - 1]!;
			} else {
				matrix[i]![j] =
					Math.min(
						matrix[i - 1]![j - 1]!, // substitution
						matrix[i]![j - 1]!, // insertion
						matrix[i - 1]![j]! // deletion
					) + 1;
			}
		}
	}
	return matrix[bn]![an]!;
}
