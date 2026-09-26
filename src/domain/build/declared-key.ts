const SEPARATOR_CHARS = "+._@-";

const INVISIBLE_FOLDER = /^\((.+)\)$/;

/** A folder written `(name)` is the folder `name`, left out of the tree. */
export function unwrapInvisibleFolder(folderName: string): {
	readonly name: string;
	readonly invisible: boolean;
} {
	const inner = INVISIBLE_FOLDER.exec(folderName)?.[1];
	return inner === undefined
		? { name: folderName, invisible: false }
		: { name: inner, invisible: true };
}

function capitalized(key: string): string {
	return key[0].toUpperCase() + key.slice(1);
}

/** The letter or digit that a capital-letter suffix has to start after. */
function isWordEnd(ch: string | undefined): boolean {
	return ch !== undefined && /[a-z0-9]/.test(ch);
}

/** The declared key that `name` spells with different letter case, if it isn't itself declared. */
export function matchKeyIgnoringCase(
	name: string,
	declaredKeys: ReadonlySet<string>
): string | undefined {
	if (declaredKeys.has(name)) return undefined;
	const lower = name.toLowerCase();
	return [...declaredKeys].find((key) => key.toLowerCase() === lower);
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
	for (const sep of SEPARATOR_CHARS) {
		const suffix = sep + key;
		if (remaining.endsWith(suffix)) {
			return { strippedLength: suffix.length, form: "separator" };
		}
	}
	return undefined;
}

function findCapitalMatch(
	remaining: string,
	key: string
): SuffixCandidate | undefined {
	const word = capitalized(key);
	if (!remaining.endsWith(word)) return undefined;

	// A bare `Server` has no base name, so it isn't a suffix.
	const startIdx = remaining.length - word.length;
	if (!isWordEnd(remaining[startIdx - 1])) return undefined;

	return { strippedLength: word.length, form: "capital" };
}

function findSuffixMatch(
	remaining: string,
	key: string
): SuffixCandidate | undefined {
	const separator = findSeparatorMatch(remaining, key);
	const capital = findCapitalMatch(remaining, key);
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
	/** A declared key that the base name still ends with after a separator, in different letter case. */
	readonly nearMissKey?: string;
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
		nearMissKey: findSeparatorNearMiss(remaining, declaredKeys),
	};
}

function findSeparatorNearMiss(
	remaining: string,
	declaredKeys: ReadonlySet<string>
): string | undefined {
	const lower = remaining.toLowerCase();
	for (const key of declaredKeys)
		for (const sep of SEPARATOR_CHARS)
			if (lower.endsWith(sep + key.toLowerCase())) return key;
	return undefined;
}
