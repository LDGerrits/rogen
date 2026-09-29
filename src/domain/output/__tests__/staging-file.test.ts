import path from "path";
import { stagingFile, stagingPattern } from "../staging-file.js";

const outFile = path.resolve("/repo", "default.project.json");

describe("stagingPattern", () => {
	it("should match the staging files of any writer", () => {
		expect(stagingPattern(outFile).test(stagingFile(outFile))).toBe(true);
		expect(stagingPattern(outFile).test(`${outFile}.tmp`)).toBe(false);
		expect(stagingPattern(outFile).test(outFile)).toBe(false);
	});
});
