import { capitalized } from "../../base/string.js";
import { ResolvedConfig } from "../config/config.js";

const SEPARATOR_CHARS = "+._@-";

export const FALLBACK_ROUTE = "*";

export interface DeclaredKeys {
	/** Every route key but `*`, which no name can spell. */
	readonly routeKeys: ReadonlySet<string>;
	readonly tagKeys: ReadonlySet<string>;
	readonly all: ReadonlySet<string>;
}

export function declaredKeysOf(
	config: Pick<ResolvedConfig, "routes" | "tags">
): DeclaredKeys {
	const routeKeys = new Set(
		Object.keys(config.routes).filter((key) => key !== FALLBACK_ROUTE)
	);
	const tagKeys = new Set(Object.keys(config.tags));
	return { routeKeys, tagKeys, all: new Set([...routeKeys, ...tagKeys]) };
}

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

export type FolderReading =
	| {
			readonly kind: "route" | "tag";
			readonly key: string;
			readonly invisible: boolean;
	  }
	| {
			readonly kind: "plain";
			readonly name: string;
			readonly invisible: boolean;
	  };

/** Whether a folder routes, carries a tag or is ordinary; parentheses come off first. */
export function readFolderName(
	folderName: string,
	routeKeys: ReadonlySet<string>,
	tagKeys: ReadonlySet<string>
): FolderReading {
	const { name, invisible } = unwrapInvisibleFolder(folderName);
	const route = matchFolderKey(name, routeKeys);
	if (route) return { kind: "route", key: route, invisible };
	const tag = matchFolderKey(name, tagKeys);
	if (tag) return { kind: "tag", key: tag, invisible };
	return { kind: "plain", name, invisible };
}

/** The same name with the first letter in the other case. */
export function withFirstLetterFlipped(name: string): string {
	const first = name[0];
	const flipped =
		first === first.toLowerCase()
			? first.toUpperCase()
			: first.toLowerCase();
	return flipped + name.slice(1);
}

/** The declared key that `name` spells exactly or with the first letter in the other case. */
function resolveKey(
	name: string,
	declaredKeys: ReadonlySet<string>
): string | undefined {
	if (name === "") return undefined;
	if (declaredKeys.has(name)) return name;
	const flipped = withFirstLetterFlipped(name);
	return declaredKeys.has(flipped) ? flipped : undefined;
}

/** The letter or digit that a capital-letter suffix has to start after. */
function isWordEnd(ch: string | undefined): boolean {
	return ch !== undefined && /[a-z0-9]/.test(ch);
}

/** The declared key that `name` only differs from beyond the first letter's case, if `name` doesn't match. */
export function matchKeyIgnoringCase(
	name: string,
	declaredKeys: ReadonlySet<string>
): string | undefined {
	if (resolveKey(name, declaredKeys) !== undefined) return undefined;
	const lower = name.toLowerCase();
	return [...declaredKeys].find((key) => key.toLowerCase() === lower);
}

export function matchFolderKey(
	folderName: string,
	declaredKeys: ReadonlySet<string>
): string | undefined {
	return resolveKey(folderName, declaredKeys);
}

export function matchMarkerKey(
	fileName: string,
	declaredKeys: ReadonlySet<string>
): string | undefined {
	if (!fileName.startsWith(".") || fileName.length < 2) return undefined;
	return resolveKey(fileName.slice(1), declaredKeys);
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
		for (const spelling of [key, withFirstLetterFlipped(key)]) {
			if (remaining.endsWith(sep + spelling)) {
				return {
					strippedLength: sep.length + spelling.length,
					form: "separator",
				};
			}
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

/** The file name with the span's suffix rewritten as `<separator><key>`. */
export function withSeparatorSuffix(
	fileName: string,
	span: SuffixSpan,
	separator: string
): string {
	return (
		fileName.slice(0, span.start) +
		separator +
		span.key +
		fileName.slice(span.start + span.length)
	);
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
