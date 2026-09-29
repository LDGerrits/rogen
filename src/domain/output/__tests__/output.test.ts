import path from "path";
import { findOutputClashes, stagingFile, stagingPattern } from "../output.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const outFile = abs("default.project.json");

describe("domain/output/output", () => {
	describe("findOutputClashes", () => {
		it("should report nothing for configs with different outputs", () => {
			expect(
				findOutputClashes([
					{
						file: abs("a.rogen.json"),
						outFile: abs("a.project.json"),
					},
					{
						file: abs("b.rogen.json"),
						outFile: abs("b.project.json"),
					},
				])
			).toEqual([]);
		});

		it("should report two configs with the same outFile as one error naming both", () => {
			const diagnostics = findOutputClashes([
				{ file: abs("a.rogen.json"), outFile: abs("out.project.json") },
				{ file: abs("b.rogen.json"), outFile: abs("out.project.json") },
			]);

			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0]).toMatchObject({
				code: "output.sameOutFile",
				resource: abs("out.project.json"),
			});
			expect(diagnostics[0].message).toContain("a.rogen.json");
			expect(diagnostics[0].message).toContain("b.rogen.json");
		});

		it("should compare normalized absolute paths", () => {
			const diagnostics = findOutputClashes([
				{
					file: abs("a.rogen.json"),
					outFile: abs("x/../out.project.json"),
				},
				{ file: abs("b.rogen.json"), outFile: abs("out.project.json") },
			]);

			expect(diagnostics).toHaveLength(1);
		});
	});

	describe("stagingPattern", () => {
		it("should match the staging files of any writer", () => {
			expect(stagingPattern(outFile).test(stagingFile(outFile))).toBe(
				true
			);
			expect(stagingPattern(outFile).test(`${outFile}.tmp`)).toBe(false);
			expect(stagingPattern(outFile).test(outFile)).toBe(false);
		});
	});
});
