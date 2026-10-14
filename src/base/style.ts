/** The ANSI codes that turn each style on and off. */
const CODES = {
	dim: [2, 22],
	strikethrough: [9, 29],
	inverse: [7, 27],
	hidden: [8, 28],
	red: [31, 39],
	green: [32, 39],
	yellow: [33, 39],
	cyan: [36, 39],
	gray: [90, 39],
} as const;

type StyleName = keyof typeof CODES;

/** `text` in `format`, whatever the stream: only a run that draws (a terminal, with colours allowed) calls this, and Rogen decides that by its own rules, which the checks of Node's `util.styleText` and of the colour libraries would second-guess. */
export function style(
	format: StyleName | readonly StyleName[],
	text: string
): string {
	const names = typeof format === "string" ? [format] : format;
	return names.reduceRight(
		(styled, name) =>
			`\u001b[${CODES[name][0]}m${styled}\u001b[${CODES[name][1]}m`,
		text
	);
}
