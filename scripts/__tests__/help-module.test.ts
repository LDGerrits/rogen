import fs from "fs";
import { currentHelpModule, OUTPUT } from "../generate-help.js";
import { diagnosticSections } from "../help-module.js";

describe("scripts/help-module", () => {
	describe("diagnosticSections", () => {
		const page = [
			"## Routes",
			"",
			"### `route.strayAt` [#route-strayat]",
			"",
			"Warning. See [`legacy.config`](#legacy-config) and [Routing](/docs/v2/core-concepts/routing#matching).",
			"",
			"```",
			"src/A@sever.luau - warning: …",
			"```",
			"",
			"## Variants",
			"",
			"Not a section.",
		].join("\n");

		it("should head each code's section with the code, up to the next heading", () => {
			expect(Object.keys(diagnosticSections(page))).toEqual([
				"route.strayAt",
			]);
			expect(diagnosticSections(page)["route.strayAt"]).not.toContain(
				"Not a section"
			);
		});

		it("should print a link as its text and address, and indent an example", () => {
			expect(diagnosticSections(page)["route.strayAt"]).toBe(
				[
					"route.strayAt",
					"",
					"Warning. See `legacy.config` and Routing (https://rogen-playfully.vercel.app/docs/v2/core-concepts/routing#matching).",
					"",
					"  src/A@sever.luau - warning: …",
				].join("\n")
			);
		});
	});

	it("should have generated the help module from the current sources", () => {
		expect(fs.readFileSync(OUTPUT, "utf8")).toBe(currentHelpModule());
	});
});
