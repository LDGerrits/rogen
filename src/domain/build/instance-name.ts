import { RojoFile, RojoFileKind } from "../rojo/rojo.js";

const INVISIBLE_FOLDER = /^\((.+)\)$/;

/** A key and its sign in a stem. */
export interface SuffixSpan {
	readonly key: string;
	readonly start: number;
	readonly length: number;
}

function unwrapInvisibleFolder(folderName: string): {
	readonly name: string;
	readonly invisible: boolean;
} {
	const inner = INVISIBLE_FOLDER.exec(folderName)?.[1];
	return inner === undefined
		? { name: folderName, invisible: false }
		: { name: inner, invisible: true };
}

function unhoisted(name: string): {
	readonly name: string;
	readonly hoisted: boolean;
} {
	return name.length > 1 && name.startsWith("^")
		? { name: name.slice(1), hoisted: true }
		: { name, hoisted: false };
}

function leafName(
	kind: RojoFileKind,
	stripped: string,
	nameCutByRule = false
): { readonly name: string; readonly hoisted: boolean } {
	return unhoisted(
		kind === "script" && !nameCutByRule
			? RojoFile.scriptNameOf(stripped)
			: stripped
	);
}

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

export const InstanceName = {
	unwrapInvisibleFolder,
	unhoisted,
	leafName,
	withoutSpans,
} as const;
