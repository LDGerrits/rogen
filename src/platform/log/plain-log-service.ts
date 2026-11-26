import { AbstractLogService, LogKind } from "./abstract-log-service.js";
import { OutputStream } from "./log-service.js";

const indented = (text: string) =>
	text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");

export class PlainLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	protected readonly drawsFrame = false;

	private inStep = false;

	protected write(kind: LogKind, stream: OutputStream, text: string): void {
		const line = stream === "stderr" ? console.error : console.info;
		switch (kind) {
			case "intro":
			case "outro":
				this.inStep = false;
				line(text);
				break;
			case "step":
				this.inStep = true;
				line(text);
				break;
			case "success":
			case "info":
				line(this.inStep ? indented(text) : text);
				break;
			case "warn":
				line(`${this.style("yellow", "warning:")} ${text}`);
				break;
			case "error":
				line(`${this.style("red", "error:")} ${text}`);
				break;
			case "debug":
			case "trace": {
				const tagged = this.style("dim", `[${kind}] ${text}`);
				line(this.inStep ? indented(tagged) : tagged);
				break;
			}
			default:
				line(text);
		}
	}
}
