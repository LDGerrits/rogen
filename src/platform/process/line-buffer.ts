/** Cuts text that arrives in pieces into the lines it holds. */
export class LineBuffer {
	private partial = "";

	/** The lines `text` completes, without their line ends; what follows the last line end waits for the rest of it. A `\r` ends a line too, as a redraw does, but one that ends `text` waits, since a `\n` may follow it. */
	push(text: string): string[] {
		const all = this.partial + text;
		const held = all.endsWith("\r") ? "\r" : "";
		const lines = all
			.slice(0, all.length - held.length)
			.split(/\r\n|\n|\r/);
		this.partial = lines.pop()! + held;
		return lines;
	}

	/** The line that never ended, if any, once nothing more will come. */
	flush(): string | undefined {
		const last = this.partial.replace(/\r$/, "");
		this.partial = "";
		return last === "" ? undefined : last;
	}
}
