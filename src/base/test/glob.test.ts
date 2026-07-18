import { isMatch } from "picomatch";
import { shouldInclude } from "../glob.js";

describe("Glob Utils", () => {
	it("should match simple patterns", () => {
		expect(isMatch("src/main.ts", "*.ts")).toBe(false);
		expect(isMatch("src/main.ts", "**/*.ts")).toBe(true);
	});

	it("should handle include/exclude logic", () => {
		const options = {
			include: ["**/*.ts"],
			exclude: ["**/test.ts"],
		};

		expect(shouldInclude("src/main.ts", options)).toBe(true);
		expect(shouldInclude("src/test.ts", options)).toBe(false);
	});
});
