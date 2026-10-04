import path from "path";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { directory, directoryOf } from "./init-fixtures.js";

describe("domain/init/init-directory", () => {
	describe("InitDirectory", () => {
		describe("checkFree", () => {
			const target = directoryOf({ existing: ["a.rogen.json"] });

			it("should name each file that already exists here", () => {
				expect(
					target.checkFree(["a.rogen.json", "b.rogen.json"])
				).toMatchObject([
					{
						code: "init.configExists",
						resource: path.join(directory, "a.rogen.json"),
					},
				]);
			});

			it("should say nothing when every file is free", () => {
				expect(target.checkFree(["b.rogen.json"])).toEqual([]);
			});
		});

		describe("projectFilesWithoutConfig", () => {
			it("should list project files no config beside them writes", () => {
				const target = directoryOf({
					existing: [
						"game.project.json",
						"other.project.json",
						"other.rogen.json",
						"notes.json",
					],
				});

				expect(target.projectFilesWithoutConfig).toEqual([
					"game.project.json",
				]);
			});
		});

		it("should name the game after the folder", () => {
			expect(directoryOf().projectName).toBe("my-game");
		});

		it("should know whether default.rogen.json is here", () => {
			expect(directoryOf().hasDefaultConfig).toBe(false);
			expect(
				directoryOf({ existing: ["default.rogen.json"] })
					.hasDefaultConfig
			).toBe(true);
		});
	});

	describe("rootDirsProblem", () => {
		const HERE = path.resolve("/repo");
		const here = directoryOf({ path: HERE });

		it("should accept separate folders", () => {
			expect(here.rootDirsProblem(["src", "lib/shared"])).toBeUndefined();
		});

		it("should accept folders that share a prefix but not a parent", () => {
			expect(here.rootDirsProblem(["src", "src2"])).toBeUndefined();
		});

		it.each([
			[[], "Enter at least one root dir."],
			[["/abs"], "Use a path relative to here, not /abs."],
			[["C:\\game"], "Use a path relative to here, not C:\\game."],
			[["../lib"], "../lib is outside this folder."],
			[["src", "./src"], "src is listed twice."],
			[
				["src", "src/Combat"],
				"src/Combat is inside src. List only one of them.",
			],
			[[".", "src"], "src is inside .. List only one of them."],
		])("should reject %j", (entries, message) => {
			expect(here.rootDirsProblem(entries)).toBe(message);
		});
	});

	describe("placeFolderProblem", () => {
		const here = directoryOf({ path: path.resolve("/repo") });

		it("should accept a folder beside the root dirs", () => {
			expect(
				here.placeFolderProblem(["src"], "places/lobby")
			).toBeUndefined();
		});

		it.each([["src/lobby"], ["src"], ["./src/"]])(
			"should reject %j, which overlaps src",
			(folder) => {
				expect(here.placeFolderProblem(["src"], folder)).toMatch(
					/overlaps src, one of default's root dirs/
				);
			}
		);

		it("should reject a folder that holds a root dir", () => {
			expect(here.placeFolderProblem(["game/src"], "game")).toMatch(
				/game overlaps game\/src/
			);
		});

		it("should reject a folder outside this one", () => {
			expect(here.placeFolderProblem(["src"], "../lobby")).toBe(
				"../lobby is outside this folder."
			);
		});
	});

	describe("defaultRootDir", () => {
		const luau = workspaceOf().language;

		it("should be src when there is one", () => {
			expect(
				directoryOf({
					workspace: { hasSrc: true, codeFolders: ["lib"] },
				}).defaultRootDir(luau)
			).toBe("src");
		});

		it("should be the only code folder when src does not exist", () => {
			expect(
				directoryOf({
					workspace: { codeFolders: ["lib"] },
				}).defaultRootDir(luau)
			).toBe("lib");
		});

		it("should fall back to src", () => {
			expect(directoryOf().defaultRootDir(luau)).toBe("src");
			expect(
				directoryOf({
					workspace: { codeFolders: ["a", "b"] },
				}).defaultRootDir(luau)
			).toBe("src");
		});
	});

	describe("otherCodeFoldersHint", () => {
		it("should name the code folders the root dir doesn't cover", () => {
			const target = directoryOf({
				workspace: { codeFolders: ["places", "shared", "src"] },
			});

			expect(target.otherCodeFoldersHint("src")).toBe(
				"Also found code in: places, shared"
			);
		});

		it("should say nothing when the root dir covers them all", () => {
			expect(
				directoryOf({
					workspace: { codeFolders: ["src"] },
				}).otherCodeFoldersHint("src/main")
			).toBeUndefined();
		});
	});
});
