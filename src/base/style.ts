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

/** `text` in `format`; the caller decides whether the stream draws, so `util.styleText`'s checks are skipped. */
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
