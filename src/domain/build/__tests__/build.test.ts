import path from "path";
import { warningDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { BuildSet, OutputFile, diagnosticsAbout } from "../build.js";
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

	describe("diagnosticsAbout", () => {
		const own = warningDiagnostic(
			"x.own",
			{ resource: "/repo/src/A.luau" },
			"own"
		);
		const group = warningDiagnostic(
			"x.group",
			{ resource: "/repo/default.rogen.json" },
			"2 files:\n  src/A.luau\n  src/B.luau",
			[
				{
					rename: {
						from: "/repo/src/A.luau",
						to: "/repo/src/a.luau",
					},
				},
				{
					rename: {
						from: "/repo/src/B.luau",
						to: "/repo/src/b.luau",
					},
				},
			],
			[
				{ resource: "/repo/src/A.luau", message: "A is odd" },
				{ resource: "/repo/src/B.luau", message: "B is odd" },
			]
		);

		it("should keep a diagnostic whose resource is the path", () => {
			expect(diagnosticsAbout([own], "/repo/src/A.luau")).toEqual([own]);
			expect(diagnosticsAbout([own], "/repo/src/B.luau")).toEqual([]);
		});

		it("should narrow a grouped one to the entry that names the path, with its own fixes", () => {
			expect(diagnosticsAbout([group], "/repo/src/B.luau")).toMatchObject(
				[
					{
						code: "x.group",
						resource: "/repo/src/B.luau",
						message: "B is odd",
						fixes: [
							{
								rename: {
									from: "/repo/src/B.luau",
									to: "/repo/src/b.luau",
								},
							},
						],
					},
				]
			);
		});

		it("should say nothing of the config a group is filed under", () => {
			expect(
				diagnosticsAbout([group], "/repo/default.rogen.json")
			).toEqual([]);
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
