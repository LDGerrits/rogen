import { InstanceReference } from "../../domain/roblox/roblox.js";

export interface StudioPath {
	readonly start: number;
	readonly end: number;
	readonly reference: InstanceReference;
	readonly line: number;
}

const COLON_FORM =
	/(?<![\w.'"/-])((?:game\.)?[A-Za-z]\w*(?:\.[^\s.:'"][^.:'"\n]*)+):(\d+)(?!\d)/g;
const QUOTED_FORM =
	/\b(?:Local|Module)?Script\s+'((?:game\.)?[^'\n]+)',\s*Line\s+(\d+)(?!\d)/g;

/** Every instance path with a line number in `text`, in the two forms Studio prints, in the order they appear. */
export function studioPathsIn(text: string): StudioPath[] {
	const found: StudioPath[] = [];
	for (const form of [COLON_FORM, QUOTED_FORM])
		for (const match of text.matchAll(form)) {
			const [span, name, line] = match;
			const reference = InstanceReference.parse(`${name}:${line}`);
			if (reference)
				found.push({
					start: match.index,
					end: match.index + span.length,
					reference,
					line: Number(line),
				});
		}
	found.sort((a, b) => a.start - b.start);
	let end = 0;
	return found.filter((path) => {
		if (path.start < end) return false;
		end = path.end;
		return true;
	});
}

/** `text` with each of `paths` that `fileOf` gives a file for written as `file:line`. */
export function rewriteStudioPaths(
	text: string,
	paths: readonly StudioPath[],
	fileOf: (instance: string) => string | undefined
): string {
	let rewritten = "";
	let from = 0;
	for (const { start, end, reference, line } of paths) {
		const file = fileOf(reference.text);
		if (file === undefined) continue;
		rewritten += `${text.slice(from, start)}${file}:${line}`;
		from = end;
	}
	return rewritten + text.slice(from);
}
