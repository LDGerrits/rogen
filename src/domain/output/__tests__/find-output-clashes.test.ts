import path from "path";
import { findOutputClashes } from "../find-output-clashes.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("domain/output/find-output-clashes", () => {
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
});
