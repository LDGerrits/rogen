import path from "path";
import { OutputFile } from "../build.js";

const outFile = path.resolve("/repo", "default.project.json");
const staged = (file: string, id: string) => `${file}.${id}.tmp`;

describe("OutputFile", () => {
	it("should match the staging files of any writer", () => {
		const { stagingPattern } = new OutputFile(outFile);

		expect(stagingPattern.test(staged(outFile, "a1b2"))).toBe(true);
		expect(stagingPattern.test(staged(outFile, "c3d4"))).toBe(true);
	});

	it("should not match the out file itself or another file", () => {
		const { stagingPattern } = new OutputFile(outFile);

		expect(stagingPattern.test(`${outFile}.tmp`)).toBe(false);
		expect(stagingPattern.test(outFile)).toBe(false);
		expect(
			stagingPattern.test(
				staged(path.resolve("/repo", "other.project.json"), "a1b2")
			)
		).toBe(false);
	});
});
