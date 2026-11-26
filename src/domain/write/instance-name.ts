import { RojoFile, RojoFileKind } from "../rojo/rojo.js";
import { readFolderName, unhoisted, unwrapInvisibleFolder } from "./write.js";

export interface SuffixSpan {
	readonly key: string;
	readonly start: number;
	readonly length: number;
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
	folderName: readFolderName,
	leafName,
	withoutSpans,
} as const;
