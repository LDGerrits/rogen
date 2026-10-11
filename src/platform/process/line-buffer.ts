/** Cuts text that arrives in pieces into the lines it holds. */
export class LineBuffer {
	private partial = "";

	/** The lines `text` completes, without their line ends; what follows the last line end waits for the rest of it. */
	push(text: string): string[] {
		const lines = (this.partial + text).split(/\r?\n/);
		this.partial = lines.pop()!;
		return lines;
	}

	/** The line that never ended, if any, once nothing more will come. */
	flush(): string | undefined {
		const last = this.partial;
		this.partial = "";
		return last === "" ? undefined : last;
	}
}
