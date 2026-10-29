import path from "path";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { InitDirectory } from "../init-directory.js";
import { directory, directoryOf } from "./init-fixtures.js";

describe("domain/init/init-directory", () => {
	describe("InitDirectory", () => {
		describe("has", () => {
			const listing = (caseInsensitive: boolean) =>
				new InitDirectory(
					directory,
					new Set(["agents.md"]),
					workspaceOf(),
					{ codeFolders: [] },
					caseInsensitive
				);

			it("should take Agents.md for agents.md where the file system does", () => {
				expect(listing(true).has("AGENTS.md")).toBe(true);
				expect(listing(true).checkFree(["AGENTS.md"])).toHaveLength(1);
			});

			it("should tell them apart where the file system does", () => {
				expect(listing(false).has("AGENTS.md")).toBe(false);
			});
		});

		describe("checkFree", () => {
			const target = directoryOf({
				existing: ["default.rogen.json", "tsconfig.json"],
			});

			it("should say a config that already exists can be deleted", () => {
				expect(target.checkFree(["default.rogen.json"])).toMatchObject([
					{
						code: "init.configExists",
						resource: path.join(directory, "default.rogen.json"),
					},
				]);
			});

			it("should say any other file that already exists is never overwritten", () => {
				expect(target.checkFree(["tsconfig.json"])).toMatchObject([
					{
						code: "init.fileExists",
						resource: path.join(directory, "tsconfig.json"),
					},
				]);
			});

			it("should name each file that already exists here", () => {
				expect(
					target
						.checkFree([
							"default.rogen.json",
							"default.rogen.jsonc",
							"tsconfig.json",
						])
						.map(({ resource }) => resource)
				).toEqual([
					path.join(directory, "default.rogen.json"),
					path.join(directory, "tsconfig.json"),
				]);
			});

			it("should say nothing when every file is free", () => {
				expect(target.checkFree(["default.rogen.jsonc"])).toEqual([]);
			});
		});

		describe("configFiles", () => {
			it("should list the config files here, sorted", () => {
				const target = directoryOf({
					existing: [
						"default.rogen.jsonc",
						"default.rogen.json",
						"default.project.json",
					],
				});

				expect(target.configFiles).toEqual([
					"default.rogen.json",
					"default.rogen.jsonc",
				]);
				expect(target.hasConfigs).toBe(true);
			});

			it("should list a named config, which init does not overwrite either", () => {
				const target = directoryOf({
					existing: ["game.rogen.json", "game.project.json"],
				});

				expect(target.configFiles).toEqual(["game.rogen.json"]);
				expect(target.hasConfigs).toBe(true);
			});

			it("should find none beside a project file alone", () => {
				const target = directoryOf({
					existing: ["default.project.json"],
				});

				expect(target.configFiles).toEqual([]);
				expect(target.hasConfigs).toBe(false);
			});
		});

		describe("hasHandWrittenProject", () => {
			it("should know whether default.project.json is here", () => {
				expect(directoryOf().hasHandWrittenProject).toBe(false);
				expect(
					directoryOf({ existing: ["default.project.json"] })
						.hasHandWrittenProject
				).toBe(true);
			});

			it("should not take another project file for it", () => {
				expect(
					directoryOf({ existing: ["lobby.project.json"] })
						.hasHandWrittenProject
				).toBe(false);
			});
		});
	});

	describe("defaultSourcePath", () => {
		const luau = workspaceOf().language;

		it("should be src when there is one", () => {
			expect(
				directoryOf({
					workspace: { hasSrc: true, codeFolders: ["lib"] },
				}).defaultSourcePath(luau)
			).toBe("src");
		});

		it("should be the only code folder when src does not exist", () => {
			expect(
				directoryOf({
					workspace: { codeFolders: ["lib"] },
				}).defaultSourcePath(luau)
			).toBe("lib");
		});

		it("should fall back to src", () => {
			expect(directoryOf().defaultSourcePath(luau)).toBe("src");
			expect(
				directoryOf({
					workspace: { codeFolders: ["a", "b"] },
				}).defaultSourcePath(luau)
			).toBe("src");
		});
	});
});
