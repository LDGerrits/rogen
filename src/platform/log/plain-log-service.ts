import { AbstractLogService, LogKind } from "./abstract-log-service.js";

const indented = (text: string) =>
	text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");

/** For output that isn't a terminal (CI, pipes, redirects): plain lines, no gutter and no colour. */
export class PlainLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	private inStep = false;

	protected write(kind: LogKind, text: string): void {
		switch (kind) {
			case "intro":
			case "outro":
				this.inStep = false;
				console.info(text);
				break;
			case "step":
				this.inStep = true;
				console.info(text);
				break;
			case "success":
			case "info":
				console.info(this.inStep ? indented(text) : text);
				break;
			case "warn":
				console.warn(`warning: ${text}`);
				break;
			case "error":
				console.error(`error: ${text}`);
				break;
			case "diagnosticWarning":
				console.warn(text);
				break;
			case "diagnosticError":
				console.error(text);
				break;
			case "debug":
			case "trace": {
				const line = `[${kind}] ${text}`;
				// On stderr, so stdout holds only results, and only JSON under --json.
				console.error(this.inStep ? indented(line) : line);
				break;
			}
			case "print":
			case "note":
				console.info(text);
				break;
			default:
				kind satisfies never;
		}
	}
}
