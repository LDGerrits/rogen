import { BuildSet } from "../build-set.js";
import { abs, configOf } from "./fixtures.js";

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
