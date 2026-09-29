import { mergeLines } from "../merge-locations.js";

describe("mergeLines", () => {
	it("should print one config's lines as they are", () => {
		expect(
			mergeLines([{ label: "default", lines: [["a", "a -> X"]] }])
		).toEqual(["a -> X"]);
	});

	it("should print a line once when every config gives the same one", () => {
		expect(
			mergeLines([
				{ label: "default", lines: [["a", "a -> X"]] },
				{ label: "lobby", lines: [["a", "a -> X"]] },
			])
		).toEqual(["a -> X"]);
	});

	it("should prefix each config's line when they differ", () => {
		expect(
			mergeLines([
				{ label: "default", lines: [["a", "a -> X"]] },
				{ label: "lobby", lines: [["a", "a -> Y"]] },
			])
		).toEqual(["default: a -> X", "lobby: a -> Y"]);
	});

	it("should prefix a line that only some configs have", () => {
		expect(
			mergeLines([
				{ label: "default", lines: [["a", "a -> X"]] },
				{
					label: "lobby",
					lines: [
						["a", "a -> X"],
						["b", "b -> Z"],
					],
				},
			])
		).toEqual(["a -> X", "lobby: b -> Z"]);
	});

	it("should keep the order the paths were first given in", () => {
		expect(
			mergeLines([
				{
					label: "default",
					lines: [
						["b", "b -> X"],
						["a", "a -> X"],
					],
				},
			])
		).toEqual(["b -> X", "a -> X"]);
	});

	it("should sort the paths when asked to", () => {
		expect(
			mergeLines(
				[
					{ label: "default", lines: [["b", "b -> X"]] },
					{ label: "lobby", lines: [["a", "a -> Y"]] },
				],
				true
			)
		).toEqual(["lobby: a -> Y", "default: b -> X"]);
	});
});
