import { defanged } from "../../base/strings.js";
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
		rewritten += `${text.slice(from, start)}${defanged(file)}:${line}`;
		from = end;
	}
	return rewritten + text.slice(from);
}
