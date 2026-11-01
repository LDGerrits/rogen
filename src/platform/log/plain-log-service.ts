import { AbstractLogService, LogKind } from "./abstract-log-service.js";

const indented = (text: string) =>
	text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");

/** For output that isn't a terminal (CI, pipes, redirects): plain lines, no gutter, and colour only when asked for. */
export class PlainLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	protected readonly drawsFrame = false;

	private inStep = false;

	protected write(kind: LogKind, text: string): void {
		const own = this.stdoutReserved ? console.error : console.info;
		switch (kind) {
			case "intro":
			case "outro":
				this.inStep = false;
				own(text);
				break;
			case "step":
			case "section":
				this.inStep = true;
				own(text);
				break;
			case "sectionBody":
				own(indented(text));
				break;
			case "success":
			case "info":
				own(this.inStep ? indented(text) : text);
				break;
			case "warn":
				console.warn(`${this.style("yellow", "warning:")} ${text}`);
				break;
			case "error":
				console.error(`${this.style("red", "error:")} ${text}`);
				break;
			case "diagnosticWarning":
				console.warn(text);
				break;
			case "diagnosticError":
			case "annotation":
			case "notice":
				console.error(text);
				break;
			case "debug":
			case "trace": {
				const line = this.style("dim", `[${kind}] ${text}`);
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
