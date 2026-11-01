import { PortableName } from "../portable-name.js";

describe("PortableName", () => {
	describe("problemWith", () => {
		it.each(["Save.luau", "Save.server.luau", "my-lib", "Foo_2", "^Hoist"])(
			"should accept %j",
			(name) => {
				expect(PortableName.problemWith(name)).toBeUndefined();
			}
		);

		it.each([
			["Bad:Name.luau", '":"'],
			["What?.luau", '"?"'],
			["a|b.luau", '"|"'],
			["a\tb.luau", '"\\t"'],
		])("should name the character %j cannot hold", (name, quoted) => {
			expect(PortableName.problemWith(name)).toContain(quoted);
		});

		it.each([
			"con.luau",
			"CON",
			"Nul.server.luau",
			"com1.luau",
			"LPT9.luau",
		])("should refuse the Windows device name %j", (name) => {
			expect(PortableName.problemWith(name)).toContain("Windows device");
		});

		it("should accept a name that only starts like a device", () => {
			expect(PortableName.problemWith("console.luau")).toBe(undefined);
		});

		it.each(["trail ", "dots.", "Folder.", "notes.txt "])(
			"should refuse %j, which ends in a space or a dot",
			(name) => {
				expect(PortableName.problemWith(name)).toContain(
					"space or a dot"
				);
			}
		);

		it.each(["trail .luau", "trail..luau", "dots..server.luau"])(
			"should accept %j, which Windows keeps since it ends in its extension",
			(name) => {
				expect(PortableName.problemWith(name)).toBeUndefined();
			}
		);

		it("should say a backslash is read as a separator", () => {
			expect(PortableName.problemWith("a\\b.luau")).toContain(
				"folder separator"
			);
		});
	});
});
