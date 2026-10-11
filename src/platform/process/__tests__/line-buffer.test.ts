import { LineBuffer } from "../line-buffer.js";

describe("LineBuffer", () => {
	it("should hand out the lines a piece completes, without their line ends", () => {
		const lines = new LineBuffer();

		expect(lines.push("a\nb\r\nc")).toEqual(["a", "b"]);
		expect(lines.push("d\n")).toEqual(["cd"]);
	});

	it("should hold a line until its end arrives", () => {
		const lines = new LineBuffer();

		expect(lines.push("Unknown fi")).toEqual([]);
		expect(lines.push("le: a\n")).toEqual(["Unknown file: a"]);
	});

	it("should keep blank lines", () => {
		expect(new LineBuffer().push("a\n\nb\n")).toEqual(["a", "", "b"]);
	});

	it("should give the line that never ended once, on flush", () => {
		const lines = new LineBuffer();
		lines.push("tail");

		expect(lines.flush()).toBe("tail");
		expect(lines.flush()).toBeUndefined();
	});

	it("should give nothing on flush when the text ended with a line end", () => {
		const lines = new LineBuffer();
		lines.push("done\n");

		expect(lines.flush()).toBeUndefined();
	});
});
