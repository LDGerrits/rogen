import { style } from "../style.js";

describe("style", () => {
	it("should wrap the text in the codes that turn the style on and off", () => {
		expect(style("green", "ok")).toBe("\u001b[32mok\u001b[39m");
	});

	it("should nest several styles, the first outermost", () => {
		expect(style(["strikethrough", "dim"], "old")).toBe(
			"\u001b[9m\u001b[2mold\u001b[22m\u001b[29m"
		);
	});
});
