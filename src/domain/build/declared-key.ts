const SEPARATOR_CHARS = "+._@-";

function isUpper(ch: string | undefined): boolean {
	return (
		ch !== undefined && ch !== ch.toLowerCase() && ch === ch.toUpperCase()
	);
}

export function matchFolderKey(
	folderName: string,
	declaredKeys: ReadonlySet<string>
): string | undefined {
	return declaredKeys.has(folderName) ? folderName : undefined;
}

export function matchMarkerKey(
	fileName: string,
	declaredKeys: ReadonlySet<string>
): string | undefined {
	if (!fileName.startsWith(".") || fileName.length < 2) return undefined;
	const key = fileName.slice(1);
	return declaredKeys.has(key) ? key : undefined;
}

export type SuffixForm = "separator" | "capital";

interface SuffixCandidate {
	readonly strippedLength: number;
	readonly form: SuffixForm;
}

function findSeparatorMatch(
	remaining: string,
	key: string
): SuffixCandidate | undefined {
	const lower = remaining.toLowerCase();
	const klower = key.toLowerCase();

	for (const sep of SEPARATOR_CHARS) {
		const suffix = sep + klower;
		if (lower.endsWith(suffix)) {
			return { strippedLength: suffix.length, form: "separator" };
		}
	}
	return undefined;
}

function findPascalMatch(
	remaining: string,
	key: string
): SuffixCandidate | undefined {
	const lower = remaining.toLowerCase();
	const klower = key.toLowerCase();
	if (!lower.endsWith(klower)) return undefined;

	const startIdx = remaining.length - klower.length;
	// A bare `Server` has no base name, so it isn't a suffix.
	if (startIdx === 0) return undefined;

	if (!isUpper(remaining[startIdx])) return undefined;
	if (isUpper(remaining[startIdx - 1])) return undefined;

	return { strippedLength: klower.length, form: "capital" };
}

function findSuffixMatch(
	remaining: string,
	key: string
): SuffixCandidate | undefined {
	const separator = findSeparatorMatch(remaining, key);
	const capital = findPascalMatch(remaining, key);
	if (!separator || !capital) return separator ?? capital;
	return capital.strippedLength > separator.strippedLength
		? capital
		: separator;
}

export interface SuffixSpan {
	readonly key: string;
	/** Where the key and its separator begin in the stem. */
	readonly start: number;
	readonly length: number;
	readonly form: SuffixForm;
}

export interface SuffixMatch {
	readonly baseName: string;
	readonly matchedKeys: ReadonlySet<string>;
	/** In match order: the trailing key first. */
	readonly spans: readonly SuffixSpan[];
}

// Only a trailing run counts: in `Foo.mock.Bar`, `Bar` stops it before `mock`.
export function matchSuffixKeys(
	stem: string,
	declaredKeys: ReadonlySet<string>
): SuffixMatch {
	let remaining = stem;
	const matched = new Set<string>();
	const spans: SuffixSpan[] = [];

	while (remaining.length > 0) {
		let bestKey: string | undefined;
		let best: SuffixCandidate | undefined;

		for (const key of declaredKeys) {
			const found = findSuffixMatch(remaining, key);
			if (found && found.strippedLength > (best?.strippedLength ?? 0)) {
				best = found;
				bestKey = key;
			}
		}

		if (!bestKey || !best) break;

		matched.add(bestKey);
		remaining = remaining.slice(0, remaining.length - best.strippedLength);
		spans.push({
			key: bestKey,
			start: remaining.length,
			length: best.strippedLength,
			form: best.form,
		});
	}

	return {
		baseName: remaining,
		matchedKeys: matched,
		spans,
	};
}
