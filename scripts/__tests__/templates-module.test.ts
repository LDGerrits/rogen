import fs from "fs";
import os from "os";
import path from "path";
import {
	OUTPUT,
	currentTemplatesModule,
	readTemplates,
	renderTemplatesModule,
} from "../generate-templates.js";

const feature = {
	"luau/src/Greeter/Shared/Greeting.luau": "return 1\n",
	"luau-places/places/shared/src/Greeter/Shared/Greeting.luau": "return 1\n",
};

describe("scripts/generate-templates", () => {
	it("should embed each file under its path", () => {
		expect(
			renderTemplatesModule({
				...feature,
				"luau/README.md": "# {{name}}\n",
			})
		).toContain(`"luau/README.md": ${JSON.stringify("# {{name}}\n")}`);
	});

	it("should refuse a placeholder init doesn't fill", () => {
		expect(() =>
			renderTemplatesModule({ ...feature, "luau/README.md": "{{title}}" })
		).toThrow("{{title}}");
	});

	it("should leave a Luau interpolation alone", () => {
		expect(() =>
			renderTemplatesModule({
				...feature,
				"luau/README.md": "`Hello, {who}!` and ${who}",
			})
		).not.toThrow();
	});

	it("should refuse a Greeter feature that differs between a language's variants", () => {
		expect(() =>
			renderTemplatesModule({
				...feature,
				"luau-places/places/shared/src/Greeter/Shared/Greeting.luau":
					"return 2\n",
			})
		).toThrow("luau and luau-places");
	});

	it("should refuse a variant for several places that lacks a file of the other", () => {
		expect(() =>
			renderTemplatesModule({
				"luau/src/Greeter/Shared/Greeting.luau": "return 1\n",
				"luau-places/README.md": "",
			})
		).toThrow("luau and luau-places");
	});

	it("should read a file with Windows line endings as LF", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "templates-"));
		fs.mkdirSync(path.join(dir, "luau"));
		fs.writeFileSync(path.join(dir, "luau", "A.luau"), "a\r\nb\r\n");
		fs.writeFileSync(path.join(dir, "README.md"), "about");

		expect(readTemplates(dir)).toEqual({ "luau/A.luau": "a\nb\n" });
	});

	it("should match the module the folder generates", () => {
		expect(fs.readFileSync(OUTPUT, "utf8")).toBe(currentTemplatesModule());
	});
});
