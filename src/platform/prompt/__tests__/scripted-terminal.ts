import { PassThrough } from "stream";
import { stripVTControlCharacters } from "util";

export const KEY = {
	enter: "\r",
	up: "\x1b[A",
	down: "\x1b[B",
	space: " ",
	ctrlC: "\x03",
} as const;

export class ScriptedTerminal {
	readonly input = Object.assign(new PassThrough(), {
		isTTY: true,
		setRawMode: () => undefined,
	});
	readonly output = Object.assign(new PassThrough(), { isTTY: true });
	private written = "";

	constructor() {
		this.output.on("data", (chunk: Buffer) => {
			this.written += chunk.toString();
		});
	}

	get screen(): string {
		return stripVTControlCharacters(this.written);
	}

	async press(...keys: string[]): Promise<void> {
		for (const key of keys) {
			this.input.write(key);
			await new Promise((resolve) => setImmediate(resolve));
		}
	}

	[Symbol.dispose](): void {
		this.input.destroy();
		this.output.destroy();
	}
}
