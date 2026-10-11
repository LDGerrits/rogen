import { styleText } from "util";

/** `text` in `format`, whatever the stream: only a run that draws (a terminal, with colours allowed) calls this, and Rogen has decided that by its own rules, which Node's own check of `CI` and `NO_COLOR` would second-guess. */
export function style(
	format: Parameters<typeof styleText>[0],
	text: string
): string {
	return styleText(format, text, { validateStream: false });
}
