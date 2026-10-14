import * as clack from "@clack/prompts";
import { style } from "../../base/style.js";
import { AbstractLogService, LogKind } from "./abstract-log-service.js";

const SYMBOLS = {
	success: style("green", "✔"),
	warning: style("yellow", "▲"),
	error: style("red", "■"),
} as const;

const nested = (text: string, symbol?: string) =>
	clack.log.message(symbol ? `${symbol} ${text}` : text, { spacing: 0 });

export class TerminalLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	protected write(kind: LogKind, text: string): void {
		switch (kind) {
			case "print":
				console.info(text);
				break;
			case "annotation":
				console.error(text);
				break;
			case "note":
				console.info(style("dim", text));
				break;
			case "notice":
				console.error(style("dim", text));
				break;
			case "intro":
				clack.intro(text);
				break;
			case "outro":
				clack.outro(text);
				break;
			case "step":
			case "section":
				clack.log.step(text);
				break;
			case "sectionBody":
				nested(text);
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
				nested(style("dim", text));
				break;
			case "info":
				nested(text);
				break;
			default:
				kind satisfies never;
		}
	}
}
