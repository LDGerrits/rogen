import { RojoFile, RojoFileKind } from "../rojo/rojo.js";

const INVISIBLE_FOLDER = /^\((.+)\)$/;

/** A key and its sign in a stem. */
export interface SuffixSpan {
	readonly key: string;
	/** Where the key and its sign begin in the stem. */
	readonly start: number;
	readonly length: number;
}

/** A folder written `(name)` is the folder `name`, left out of the tree. */
function unwrapInvisibleFolder(folderName: string): {
	readonly name: string;
	readonly invisible: boolean;
} {
	const inner = INVISIBLE_FOLDER.exec(folderName)?.[1];
	return inner === undefined
		? { name: folderName, invisible: false }
		: { name: inner, invisible: true };
}

/** A name that starts with `^` is hoisted to its route's target; the `^` comes off it. */
function unhoisted(name: string): {
	readonly name: string;
	readonly hoisted: boolean;
} {
	return name.length > 1 && name.startsWith("^")
		? { name: name.slice(1), hoisted: true }
		: { name, hoisted: false };
}

/** The name Rojo gives a file's stem once the keys are off it, then with its `^` off. */
function leafName(
	kind: RojoFileKind,
	stripped: string
): { readonly name: string; readonly hoisted: boolean } {
	return unhoisted(
		kind === "script" ? RojoFile.scriptNameOf(stripped) : stripped
	);
}

/** `name` with the text of each of `spans` cut out of it. */
function withoutSpans(name: string, spans: readonly SuffixSpan[]): string {
	return [...spans]
		.sort((a, b) => b.start - a.start)
		.reduce(
			(kept, span) =>
				kept.slice(0, span.start) +
				kept.slice(span.start + span.length),
			name
		);
}

/** How a file or folder name turns into the name of its instance. */
export const InstanceName = {
	unwrapInvisibleFolder,
	unhoisted,
	leafName,
	withoutSpans,
} as const;
