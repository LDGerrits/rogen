const SEPARATOR_CHARS = "+._@-";

function isSeparator(ch: string): boolean {
	return SEPARATOR_CHARS.includes(ch);
}

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

interface SuffixCandidate {
	readonly strippedLength: number;
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
			return { strippedLength: suffix.length };
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

	return { strippedLength: klower.length };
}

export interface SuffixMatch {
	readonly baseName: string;
	readonly matchedKeys: ReadonlySet<string>;
	readonly undeclaredSuffix: string | undefined;
}

// Only a trailing run counts: in `Foo.mock.Bar`, `Bar` stops it before `mock`.
export function matchSuffixKeys(
	stem: string,
	declaredKeys: ReadonlySet<string>
): SuffixMatch {
	let remaining = stem;
	const matched = new Set<string>();

	while (remaining.length > 0) {
		let bestKey: string | undefined;
		let bestStrip = 0;

		for (const key of declaredKeys) {
			const strip = Math.max(
				findSeparatorMatch(remaining, key)?.strippedLength ?? 0,
				findPascalMatch(remaining, key)?.strippedLength ?? 0
			);
			if (strip > bestStrip) {
				bestStrip = strip;
				bestKey = key;
			}
		}

		if (!bestKey) break;

		matched.add(bestKey);
		remaining = remaining.slice(0, remaining.length - bestStrip);
	}

	return {
		baseName: remaining,
		matchedKeys: matched,
		undeclaredSuffix: trailingCandidate(remaining),
	};
}

function trailingCandidate(remaining: string): string | undefined {
	if (remaining.length === 0) return undefined;

	for (let i = remaining.length - 1; i >= 0; i--) {
		if (isSeparator(remaining[i])) {
			return i < remaining.length - 1
				? remaining.slice(i + 1)
				: undefined;
		}
	}

	for (let i = remaining.length - 1; i > 0; i--) {
		const ch = remaining[i];
		if (!isUpper(ch)) continue;
		if (!isUpper(remaining[i - 1])) return remaining.slice(i);
		return undefined;
	}

	return undefined;
}

const ROJO_SCRIPT_SUFFIXES = [".server", ".client"] as const;

// The name Rojo gives a file in a synced directory, independent of the config.
export function rojoAssignedName(stem: string): string {
	for (const suffix of ROJO_SCRIPT_SUFFIXES) {
		if (stem.endsWith(suffix)) {
			return stem.slice(0, -suffix.length);
		}
	}
	return stem;
}
