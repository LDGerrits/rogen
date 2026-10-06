import path from "path";
import { BuildSet, OutputFile } from "../build.js";
import { abs, configOf } from "./fixtures.js";

const outFile = path.resolve("/repo", "default.project.json");
const staged = (file: string, id: string) => `${file}.${id}.tmp`;

describe("domain/build/build", () => {
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

	describe("BuildSet", () => {
		it("should block every config that shares an out file, each with the same error", () => {
			const blockers = new BuildSet([
				configOf(),
				configOf({ file: abs("other.rogen.json") }),
				configOf({
					file: abs("lobby.rogen.json"),
					outFile: abs("lobby.project.json"),
				}),
			]);

			expect([...blockers.blockedFiles]).toEqual([
				abs("default.rogen.json"),
				abs("other.rogen.json"),
			]);
			expect(blockers.diagnostics).toMatchObject([
				{ code: "output.sameOutFile" },
			]);
			expect(blockers.blocking(abs("other.rogen.json"))).toEqual(
				blockers.diagnostics
			);
		});

		it("should block a config that declares no routes", () => {
			const blockers = new BuildSet([configOf({ routes: {} })]);

			expect(blockers.blocking(abs("default.rogen.json"))).toMatchObject([
				{ code: "route.noRoutes" },
			]);
		});

		it("should list each problem once, the configs without routes first", () => {
			const blockers = new BuildSet([
				configOf({ routes: {} }),
				configOf({ file: abs("other.rogen.json") }),
			]);

			expect(blockers.diagnostics.map(({ code }) => code)).toEqual([
				"route.noRoutes",
				"output.sameOutFile",
			]);
		});

		it("should block nothing when every config can be built", () => {
			const blockers = new BuildSet([configOf()]);

			expect(blockers.blockedFiles.size).toBe(0);
			expect(blockers.blocking(abs("default.rogen.json"))).toEqual([]);
		});
	});
});
