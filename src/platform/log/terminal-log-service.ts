import * as clack from "@clack/prompts";
import { Writable } from "stream";
import { stripVTControlCharacters } from "util";
import {
	AbstractLogService,
	LogKind,
	LogServiceOptions,
} from "./abstract-log-service.js";
import { OutputStream } from "./log-service.js";

class Uncoloured extends Writable {
	constructor(private readonly stream: NodeJS.WriteStream) {
		super();
	}

	override _write(
		chunk: unknown,
		_encoding: BufferEncoding,
		done: (error?: Error | null) => void
	): void {
		this.stream.write(stripVTControlCharacters(String(chunk)));
		done();
	}
}

export class TerminalLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	protected readonly drawsFrame = true;

	private readonly symbols: Readonly<
		Record<"success" | "warning" | "error", string>
	>;
	private readonly outputs: Readonly<Record<OutputStream, Writable>>;

	constructor(options: LogServiceOptions = {}) {
		super(options);
		this.symbols = {
			success: this.style("green", "✔"),
			warning: this.style("yellow", "▲"),
			error: this.style("red", "■"),
		};
		this.outputs = options.color
			? { stdout: process.stdout, stderr: process.stderr }
			: {
					stdout: new Uncoloured(process.stdout),
					stderr: new Uncoloured(process.stderr),
				};
	}

	protected write(kind: LogKind, stream: OutputStream, text: string): void {
		const line = stream === "stderr" ? console.error : console.info;
		const output = this.outputs[stream];
		switch (kind) {
			case "result":
			case "annotation":
				line(text);
				return;
			case "note":
			case "notice":
				line(this.style("dim", text));
				return;
			case "intro":
				clack.intro(text, { output });
				return;
			case "step":
				clack.log.step(text, { output });
				return;
		}
		if (!this.framed) return this.writeUnframed(kind, line, text);
		const { symbols } = this;
		const nested = (message: string, symbol?: string) =>
			clack.log.message(symbol ? `${symbol} ${message}` : message, {
				spacing: 0,
				output,
			});
		switch (kind) {
			case "outro":
				clack.outro(text, { output });
				break;
			case "success":
				nested(text, symbols.success);
				break;
			case "warn":
			case "diagnosticWarning":
				nested(text, symbols.warning);
				break;
			case "error":
			case "diagnosticError":
				nested(text, symbols.error);
				break;
			case "debug":
			case "trace":
				nested(this.style("dim", text));
				break;
			default:
				nested(text);
		}
	}

	private writeUnframed(
		kind: LogKind,
		line: (text: string) => void,
		text: string
	): void {
		switch (kind) {
			case "debug":
			case "trace":
				line(this.style("dim", text));
				break;
			case "warn":
			case "diagnosticWarning":
				line(`${this.symbols.warning} ${text}`);
				break;
			case "error":
			case "diagnosticError":
				line(`${this.symbols.error} ${text}`);
				break;
			default:
				line(text);
		}
	}
}
