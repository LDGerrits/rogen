import path from "path";
import {
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import {
	BuildRun,
	BuildSet,
	BuildSummary,
	FailedBuild,
	OutputFile,
	UnloadedBuild,
	WrittenBuild,
} from "../build.js";
import { abs, configOf } from "./fixtures.js";

const outFile = path.resolve("/repo", "default.project.json");
const staged = (file: string, id: string) => `${file}.${id}.tmp`;

const summary: BuildSummary = {
	roots: [],
	routes: [],
	variants: [],
	modes: [],
	unrouted: 0,
	replaced: 0,
	displaced: 0,
};

describe("domain/build/build", () => {
	describe("BuildRun", () => {
		const lobby = configOf({ file: abs("lobby.rogen.json") });
		const arena = configOf({ file: abs("arena.rogen.json") });
		const shared = warningDiagnostic(
			"x.shared",
			{ resource: abs("src/A.luau") },
			"shared"
		);
		const ownFile = (file: string) =>
			warningDiagnostic("x.own", { resource: file }, "own");
		const written = (
			config: typeof lobby,
			warnings: ReturnType<typeof warningDiagnostic>[],
			syncWarnings: ReturnType<typeof warningDiagnostic>[] = []
		) =>
			new WrittenBuild(
				config,
				"wrote",
				{ warnings, syncWarnings },
				summary,
				[]
			);

		it("should count a warning several configs share once", () => {
			const run = new BuildRun([
				written(lobby, [shared]),
				written(arena, [shared]),
			]);

			expect(run.warningCount).toBe(1);
			expect(run.diagnostics).toEqual([shared]);
			expect(run.shares[1].warnings).toEqual({
				fresh: [],
				sameAs: ["lobby"],
			});
		});

		it("should take a warning about each config's own file as the same one", () => {
			const run = new BuildRun([
				written(lobby, [ownFile(lobby.file)]),
				written(arena, [ownFile(arena.file)]),
			]);

			expect(run.warningCount).toBe(1);
		});

		it("should count sync dir warnings with the rest", () => {
			const run = new BuildRun([written(lobby, [], [shared])]);

			expect(run.warningCount).toBe(1);
		});

		it("should fail with every error, and say each error once", () => {
			const error = errorDiagnostic(
				"x.error",
				{ resource: abs("src/A.luau") },
				"broken"
			);
			const run = new BuildRun([
				new FailedBuild(lobby, [error]),
				new UnloadedBuild(abs("arena.rogen.json"), [error]),
			]);

			expect(run.failed).toBe(true);
			expect(run.errors).toEqual([error, error]);
			expect(run.diagnostics).toEqual([error]);
			expect(run.shares[1].errors.sameAs).toEqual(["lobby"]);
		});

		it("should not fail a run whose configs all built", () => {
			expect(new BuildRun([written(lobby, [shared])]).failed).toBe(false);
		});
	});

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
