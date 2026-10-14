import { GitIgnore } from "../git-ignore.js";

const FILES = ["default.project.json", "sourcemap.json"];

describe("GitIgnore", () => {
	describe("planned", () => {
		it("should write a new .gitignore with the files under a comment saying why", () => {
			const planned = new GitIgnore(undefined).planned(FILES);

			expect(planned).toEqual({
				fileName: ".gitignore",
				content:
					"# Written by Rogen from rogen.json\n/default.project.json\n/sourcemap.json\n",
			});
		});

		it("should append the files after a blank line, keeping every byte before them", () => {
			const planned = new GitIgnore("node_modules/\n").planned(FILES);

			expect(planned).toEqual({
				fileName: ".gitignore",
				content:
					"node_modules/\n\n# Written by Rogen from rogen.json\n/default.project.json\n/sourcemap.json\n",
				addition: "the files Rogen writes",
			});
		});

		it("should end a last line that has no newline before the blank line", () => {
			const { content } = new GitIgnore("node_modules/").planned(FILES)!;

			expect(content.startsWith("node_modules/\n\n# Written")).toBe(true);
		});

		it("should write CRLF line endings into a file that has them", () => {
			const { content } = new GitIgnore("node_modules/\r\n").planned(
				FILES
			)!;

			expect(content).not.toMatch(/(?<!\r)\n/);
		});

		it("should leave out a file that a line already ignores, anchored or not", () => {
			const planned = new GitIgnore(
				"default.project.json\n/sourcemap.json\n"
			).planned([
				"default.project.json",
				"sourcemap.json",
				"dist.project.json",
			]);

			expect(planned?.content).toBe(
				"default.project.json\n/sourcemap.json\n\n# Written by Rogen from rogen.json\n/dist.project.json\n"
			);
		});

		it("should plan nothing when every file is ignored already", () => {
			expect(
				new GitIgnore(
					"/default.project.json\n/sourcemap.json\n"
				).planned(FILES)
			).toBeUndefined();
		});

		it("should not take a comment for an ignore line", () => {
			const planned = new GitIgnore("# default.project.json\n").planned(
				FILES
			);

			expect(planned?.content).toContain("\n/default.project.json\n");
		});

		it("should leave out a file that a line un-ignores, since the user chose to commit it", () => {
			const planned = new GitIgnore(
				"*.json\n!default.project.json\n!/sourcemap.json\n"
			).planned([
				"default.project.json",
				"dist.project.json",
				"sourcemap.json",
			]);

			expect(planned?.content).toBe(
				"*.json\n!default.project.json\n!/sourcemap.json\n\n# Written by Rogen from rogen.json\n/dist.project.json\n"
			);
		});

		it("should never write a pattern for all project files", () => {
			const planned = new GitIgnore(undefined).planned([
				"default.project.json",
				"dist.project.json",
			]);

			expect(planned?.content).not.toContain("*");
			expect(planned?.content).toContain("/dist.project.json");
		});
	});
});
