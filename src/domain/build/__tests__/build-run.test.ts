import {
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import {
	BuildSummary,
	FailedBuild,
	UnloadedBuild,
	WrittenBuild,
} from "../build.js";
import { BuildRun } from "../build-run.js";
import { abs, configOf } from "./fixtures.js";

const summary: BuildSummary = {
	roots: [],
	routes: [],
	variants: [],
	modes: [],
	unrouted: 0,
	replaced: 0,
	displaced: 0,
};

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

	it("should give the failure of a run: its errors, or its warnings only when they are denied", () => {
		const error = errorDiagnostic(
			"x.error",
			{ resource: abs("src/A.luau") },
			"broken"
		);
		const warned = new BuildRun([written(lobby, [shared])]);
		const broken = new BuildRun([new FailedBuild(lobby, [error])]);

		expect(warned.failure(false)).toBeUndefined();
		expect(warned.failure(true)?.message).toBe(
			"1 warning denied by --deny-warnings."
		);
		expect(broken.failure(false)).toMatchObject({
			diagnostics: [error],
		});
		expect(new BuildRun([]).failure(true)).toBeUndefined();
	});
});
