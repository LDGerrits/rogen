export class LineBuffer {
	private partial = "";

	push(text: string): string[] {
		const all = this.partial + text;
		const held = all.endsWith("\r") ? "\r" : "";
		const lines = all
			.slice(0, all.length - held.length)
			.split(/\r\n|\n|\r/);
		this.partial = lines.pop()! + held;
		return lines;
	}

	flush(): string | undefined {
		const last = this.partial.replace(/\r$/, "");
		this.partial = "";
		return last === "" ? undefined : last;
	}
}
