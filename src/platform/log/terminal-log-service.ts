import * as clack from "@clack/prompts";
import { styleText } from "util";
import { AbstractLogService, LogKind } from "./log-service.js";

const SYMBOLS = {
	success: styleText("green", "✔"),
	warning: styleText("yellow", "▲"),
	error: styleText("red", "■"),
} as const;

const nested = (text: string, symbol?: string) =>
	clack.log.message(symbol ? `${symbol} ${text}` : text, { spacing: 0 });

/** Draws with the prompt library's gutter and symbols, the same look as the init questions. */
export class TerminalLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	protected write(kind: LogKind, text: string): void {
		switch (kind) {
			case "print":
				console.info(text);
				break;
			case "intro":
				clack.intro(text);
				break;
			case "outro":
				clack.outro(text);
				break;
			case "step":
				clack.log.step(text);
				break;
			case "success":
				nested(text, SYMBOLS.success);
				break;
			case "warn":
			case "diagnosticWarning":
				nested(text, SYMBOLS.warning);
				break;
			case "error":
			case "diagnosticError":
				nested(text, SYMBOLS.error);
				break;
			case "debug":
			case "trace":
				nested(styleText("dim", text));
				break;
			case "info":
				nested(text);
		}
	}
}
