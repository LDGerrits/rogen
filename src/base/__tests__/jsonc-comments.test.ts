import { JsoncComments } from "../jsonc-comments.js";

const of = (text: string) => {
	const comments = JsoncComments.of(text);
	if (!comments) throw new Error("not JSONC");
	return comments;
};

describe("JsoncComments", () => {
	describe("of", () => {
		it("should be undefined for text that isn't valid", () => {
			expect(JsoncComments.of('{ "a": ')).toBeUndefined();
		});

		it("should be empty for a document without comments, and not count a // in a string", () => {
			expect(of('{ "a": "// not a comment" }').isEmpty).toBe(true);
		});
	});

	describe("at", () => {
		it("should give a comment on its own line to the entry after it", () => {
			const comments = of(
				'{\n  // the name\n  "name": "a",\n  "b": 1\n}'
			);

			expect(comments.at(["name"]).leading).toEqual([["// the name"]]);
			expect(comments.at(["b"]).leading).toEqual([]);
		});

		it("should give a comment at the end of a line to the entry on that line, after its comma or not", () => {
			const comments = of('{\n  "a": 1, // one\n  "b": 2 /* two */\n}');

			expect(comments.at(["a"]).trailing).toEqual([["// one"]]);
			expect(comments.at(["b"]).trailing).toEqual([["/* two */"]]);
		});

		it("should keep a comment after the { on its line as the opening of the object", () => {
			const comments = of('{ // top\n  "a": 1\n}');

			expect(comments.at([]).opening).toEqual([["// top"]]);
		});

		it("should give a block comment followed by an entry on its line to that entry", () => {
			const comments = of('{ /* b */ "a": { "c": 1 } }');

			expect(comments.at(["a"]).leading).toEqual([["/* b */"]]);
		});

		it("should keep a comment before a closing brace or bracket at the end of that object or array", () => {
			const comments = of(
				'{\n  "a": [\n    1\n    // last\n  ],\n  // end\n}'
			);

			expect(comments.at(["a"]).closing).toEqual([["// last"]]);
			expect(comments.at([]).closing).toEqual([["// end"]]);
		});

		it("should find the entries of nested objects and arrays by their path", () => {
			const comments = of(
				'{\n  "tree": {\n    // child\n    "W": [\n      // item\n      1\n    ]\n  }\n}'
			);

			expect(comments.at(["tree", "W"]).leading).toEqual([["// child"]]);
			expect(comments.at(["tree", "W", 0]).leading).toEqual([
				["// item"],
			]);
		});

		it("should put a comment between a key and its value with the entry", () => {
			const comments = of('{ "a": /* why */ 1 }');

			expect(comments.at(["a"]).leading).toEqual([["/* why */"]]);
		});

		it("should keep comments before and after the document", () => {
			const comments = of('// top\n{ "a": 1 }\n// bottom');

			expect(comments.at([]).leading).toEqual([["// top"]]);
			expect(comments.at([]).trailing).toEqual([["// bottom"]]);
		});

		it("should give a comment in an empty object to the object", () => {
			const comments = of('{ "a": {\n  // nothing\n} }');

			expect(comments.at(["a"]).closing).toEqual([["// nothing"]]);
		});

		it("should take the indentation of the line a block comment starts on off its other lines", () => {
			const comments = of('{\n  /* one\n     two */\n  "a": 1\n}');

			expect(comments.at(["a"]).leading).toEqual([
				["/* one", "   two */"],
			]);
		});

		it("should handle a trailing comma", () => {
			const comments = of('{\n  "a": 1, // one\n}');

			expect(comments.at(["a"]).trailing).toEqual([["// one"]]);
		});

		it("should keep several comments in the order of the text", () => {
			const comments = of('{\n  // x\n  // y\n  "a": 1 // z\n}');

			expect(comments.at(["a"]).leading).toEqual([["// x"], ["// y"]]);
			expect(comments.at(["a"]).trailing).toEqual([["// z"]]);
		});
	});
});
