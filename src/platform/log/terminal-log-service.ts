import * as clack from "@clack/prompts";
import { Writable } from "stream";
import { stripVTControlCharacters } from "util";
import { Styler, style, unstyled } from "../../base/style.js";
import { AbstractLogService, LogKind } from "./abstract-log-service.js";

/** Stdout with the colours clack draws taken out. */
class UncolouredStdout extends Writable {
	get columns(): number | undefined {
		return process.stdout.columns;
	}

	override _write(
		chunk: unknown,
		_encoding: BufferEncoding,
		done: (error?: Error | null) => void
	): void {
		process.stdout.write(stripVTControlCharacters(String(chunk)));
		done();
	}
}

export class TerminalLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	protected readonly drawsFrame = true;

	private readonly style: Styler;
	private readonly symbols: Readonly<
		Record<"success" | "warning" | "error", string>
	>;
	private readonly output?: Writable;

	/** `color` false draws the same layout without colour. */
	constructor(cwd?: string, annotationsIn?: string, color = true) {
		super(cwd, annotationsIn);
		this.style = color ? style : unstyled;
		this.symbols = {
			success: this.style("green", "✔"),
			warning: this.style("yellow", "▲"),
			error: this.style("red", "■"),
		};
		if (!color) this.output = new UncolouredStdout();
	}

	protected write(kind: LogKind, text: string): void {
		if (!this.framed && this.writeUnframed(kind, text)) return;
		const { output, symbols } = this;
		const nested = (line: string, symbol?: string) =>
			clack.log.message(symbol ? `${symbol} ${line}` : line, {
				spacing: 0,
				output,
			});
		switch (kind) {
			case "print":
				console.info(text);
				break;
			case "annotation":
				console.error(text);
				break;
			case "note":
				console.info(this.style("dim", text));
				break;
			case "notice":
				console.error(this.style("dim", text));
				break;
			case "intro":
				clack.intro(text, { output });
				break;
			case "outro":
				clack.outro(text, { output });
				break;
			case "step":
			case "section":
				clack.log.step(text, { output });
				break;
			case "sectionBody":
				nested(text);
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
			case "info":
				nested(text);
				break;
			default:
				kind satisfies never;
		}
	}

	/** A line outside a frame, written plainly as Rojo writes its own; false for the kinds that always draw one. */
	private writeUnframed(kind: LogKind, text: string): boolean {
		switch (kind) {
			case "success":
			case "info":
			case "outro":
				(this.stdoutReserved ? console.error : console.info)(text);
				return true;
			case "debug":
			case "trace":
				console.error(this.style("dim", text));
				return true;
			case "warn":
			case "diagnosticWarning":
				console.error(`${this.symbols.warning} ${text}`);
				return true;
			case "error":
			case "diagnosticError":
				console.error(`${this.symbols.error} ${text}`);
				return true;
			default:
				return false;
		}
	}
}
