import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { InitDirectory } from "../init-directory.js";
import { directory, directoryOf } from "./init-fixtures.js";

describe("domain/init/init-directory", () => {
	describe("InitDirectory", () => {
		describe("defaultConfig", () => {
			let fs: MemoryFileSystemService;

			const write = (file: string, content: unknown) =>
				fs.writeFile(
					path.join(directory, file),
					JSON.stringify(content)
				);

			const withTarget = async <T>(
				read: (target: InitDirectory) => Promise<T>
			): Promise<T> => {
				const configService = new CoreConfigService(
					fs,
					new MockEnvironmentService({ _: [] }, directory)
				);
				const target = new InitDirectory(
					directory,
					new Set(["default.rogen.json"]),
					workspaceOf(),
					undefined,
					"default",
					fs,
					configService
				);
				const result = await read(target);
				configService[Symbol.dispose]();
				return result;
			};

			const readBase = () =>
				withTarget((target) => target.defaultConfig());

			beforeEach(async () => {
				fs = new MemoryFileSystemService();
				await fs.createDirectory(directory);
			});

			it("should read the root dirs of default.rogen.json relative to the directory", async () => {
				await write("default.rogen.json", {
					rootDirs: ["src", "shared"],
				});

				const base = (await readBase()).unwrap();

				expect(base).toEqual({ rootDirs: ["src", "shared"] });
			});

			it("should read the resolved value through extends", async () => {
				await write("default.rogen.json", {
					extends: "./core.rogen.json",
					syncDir: "dist",
				});
				await write("core.rogen.json", { rootDirs: ["core"] });

				const base = (await readBase()).unwrap();

				expect(base).toEqual({ rootDirs: ["core"], syncDir: "dist" });
			});

			it("should read another config's sync dir through extends", async () => {
				await write("default.rogen.json", { rootDirs: ["src"] });
				await write("sync.rogen.json", {
					extends: "./default.rogen.json",
					syncDir: "dist",
				});

				expect(
					await withTarget((target) =>
						target.syncDirOf("sync.rogen.json")
					)
				).toBe("dist");
			});

			it("should fail with diagnostics when default.rogen.json is broken", async () => {
				await fs.writeFile(
					path.join(directory, "default.rogen.json"),
					"{ nope"
				);

				const result = await readBase();

				expect(result.isErr()).toBe(true);
				expect(
					(result as ResultError<Diagnostic[]>).error.length
				).toBeGreaterThan(0);
			});

			it("should read it once", async () => {
				const target = directoryOf();

				expect(target.defaultConfig()).toBe(target.defaultConfig());
			});
		});

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

		describe("readFile", () => {
			it("should read a file here", async () => {
				const fs = new MemoryFileSystemService();
				await fs.createDirectory(directory);
				await fs.writeFile(path.join(directory, "a.json"), "{}");

				const read = await directoryOf({ fileSystem: fs }).readFile(
					"a.json"
				);

				expect(read.unwrap()).toBe("{}");
			});

			it("should say which file it couldn't read", async () => {
				const read = await directoryOf().readFile("missing.json");

				expect(read.isErr() && read.error).toMatchObject([
					{
						code: "init.templateUnreadable",
						resource: path.join(directory, "missing.json"),
					},
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
