import { stripVTControlCharacters } from "util";

export function capitalized(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

const escaped = (char: string) =>
	char === "\n" || char === "\t"
		? char
		: `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;

/**
 * `text` with each control character other than a newline or tab, each line
 * separator and each bidirectional override written as an escape, and no line
 * left to start a CI workflow command (`::error::`), since a file name can hold
 * both.
 */
export function defanged(text: string): string {
	return text
		.replace(/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, escaped)
		.replace(/^([ \t]*):(?=:)/gm, "$1\\u003a");
}

export function listLimited(items: readonly string[], limit: number): string {
	const listed = items.slice(0, limit).join(", ");
	return items.length > limit ? `${listed}, …` : listed;
}

export function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function unlistedNote(count: number): string {
	return `${count} more like it ${count === 1 ? "isn't" : "aren't"} listed.`;
}

export function editDistanceWithSwaps(a: string, b: string): number {
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

export function closestMatch(
	word: string,
	candidates: Iterable<string>
): string | undefined {
	return closestMatches(word, candidates)[0];
}

const MAX_EDITS_PER_LETTER = 0.4;

export function closestMatches(
	word: string,
	candidates: Iterable<string>
): string[] {
	const lower = word.toLowerCase();
	let best: string[] = [];
	let bestDistance = Math.floor(word.length * MAX_EDITS_PER_LETTER) + 1;
	for (const candidate of candidates) {
		const distance = editDistanceWithSwaps(lower, candidate.toLowerCase());
		if (distance < bestDistance) {
			best = [candidate];
			bestDistance = distance;
		} else if (distance === bestDistance && best.length > 0) {
			best.push(candidate);
		}
	}
	return best;
}

export function joinedClosestFirst(
	word: string,
	items: readonly string[]
): string {
	const closest = closestMatch(word, items);
	return joinedWithAnd(
		closest === undefined
			? items
			: [closest, ...items.filter((item) => item !== closest)]
	);
}

export function joinedWithAnd(items: readonly string[]): string {
	return joinedWith(items, "and");
}

export function joinedBriefly(items: readonly string[], shown: number): string {
	const more = items.length - shown;
	return more > 0
		? `${items.slice(0, shown).join(", ")} and ${more} more`
		: joinedWithAnd(items);
}

export function joinedWithOr(items: readonly string[]): string {
	return joinedWith(items, "or");
}

function joinedWith(items: readonly string[], word: string): string {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

export function firstLine(text: string): string | undefined {
	return stripVTControlCharacters(text)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line !== "");
}

export const shellWord = (arg: string): string =>
	/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;

export const commandWith = (command: string, argument: string): string =>
	argument === "" ? command : `${command} ${shellWord(argument)}`;
