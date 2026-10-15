import { PortableName } from "../portable-name.js";

describe("PortableName", () => {
	describe("problemWith", () => {
		it.each(["Save.luau", "Save.server.luau", "my-lib", "Foo_2", "^Hoist"])(
			"should accept %j",
			(name) => {
				expect(PortableName.problemWith(name, name)).toBeUndefined();
			}
		);

		it.each([
			["Bad:Name.luau", "Bad:Name", '":"'],
			["What?.luau", "What?", '"?"'],
			["a|b.luau", "a|b", '"|"'],
			["a\tb.luau", "a\tb", '"\\t"'],
		])("should name the character %j cannot hold", (name, stem, quoted) => {
			expect(PortableName.problemWith(name, stem)).toContain(quoted);
		});

		it.each([
			"con.luau",
			"CON",
			"Nul.server.luau",
			"com1.luau",
			"LPT9.luau",
		])("should refuse the Windows device name %j", (name) => {
			expect(PortableName.problemWith(name, name)).toContain(
				"Windows device"
			);
		});

		it("should accept a name that only starts like a device", () => {
			expect(PortableName.problemWith("console.luau", "console")).toBe(
				undefined
			);
		});

		it.each([
			["trail .luau", "trail "],
			["dots..luau", "dots."],
		])(
			"should refuse %j, whose name ends in a space or a dot",
			(name, stem) => {
				expect(PortableName.problemWith(name, stem)).toContain(
					"space or a dot"
				);
			}
		);

		it("should say a backslash is read as a separator", () => {
			expect(PortableName.problemWith("a\\b.luau", "a\\b")).toContain(
				"folder separator"
			);
		});
	});
});
