import path from "path";
import { OutputFile } from "../build-service.js";

const outFile = path.resolve("/repo", "default.project.json");

describe("domain/build/build-service", () => {
	describe("OutputFile", () => {
		it("should stage a write through a file of its own each time", () => {
			const output = new OutputFile(outFile);

			expect(output.stagingFile()).not.toBe(output.stagingFile());
			expect(output.stagingFile().startsWith(`${outFile}.`)).toBe(true);
			expect(output.stagingFile().endsWith(".tmp")).toBe(true);
		});

		it("should match the staging files of any writer", () => {
			const output = new OutputFile(outFile);

			expect(output.stagingPattern.test(output.stagingFile())).toBe(true);
			expect(
				output.stagingPattern.test(
					new OutputFile(outFile).stagingFile()
				)
			).toBe(true);
		});

		it("should not match the out file itself or another file", () => {
			const { stagingPattern } = new OutputFile(outFile);

			expect(stagingPattern.test(`${outFile}.tmp`)).toBe(false);
			expect(stagingPattern.test(outFile)).toBe(false);
			expect(
				stagingPattern.test(
					new OutputFile(
						path.resolve("/repo", "other.project.json")
					).stagingFile()
				)
			).toBe(false);
		});
	});
});
