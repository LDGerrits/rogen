import { isIgnored } from "../../../platform/watcher/ignored-paths.js";
import { createWatchPlan, WatchPlanConfig } from "../watch-plan.js";

const config = (
	file: string,
	rootDirs: string[],
	extra: Partial<WatchPlanConfig> = {}
): WatchPlanConfig => ({
	file,
	rootDirs,
	outFile: file.replace(".rogen.json", ".project.json"),
	...extra,
});

describe("domain/watch/watch-plan", () => {
	describe("roots", () => {
		it("should list a root shared by two configs once", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
				config("/repo/source.rogen.json", ["/repo/src"]),
			]);

			expect(plan.roots).toEqual(["/repo/src"]);
		});

		it("should drop a root inside another", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
				config("/repo/lobby.rogen.json", ["/repo/src/shared"]),
			]);

			expect(plan.roots).toEqual(["/repo/src"]);
		});

		it("should not widen roots to their common parent", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", [
					"/repo/places/lobby",
					"/repo/places/shared",
				]),
			]);

			expect(plan.roots).toEqual([
				"/repo/places/lobby",
				"/repo/places/shared",
			]);
		});
	});

	describe("configsFor", () => {
		it("should return every config whose roots contain the path", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
				config("/repo/lobby.rogen.json", ["/repo/src/shared"]),
			]);

			expect(plan.configsFor("/repo/src/shared/A.luau")).toEqual([
				"/repo/default.rogen.json",
				"/repo/lobby.rogen.json",
			]);
		});

		it("should return a config once when several of its roots contain the path", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", [
					"/repo/src",
					"/repo/src/shared",
				]),
			]);

			expect(plan.configsFor("/repo/src/shared/A.luau")).toEqual([
				"/repo/default.rogen.json",
			]);
		});

		it("should skip a config whose roots do not contain the path", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
				config("/repo/lobby.rogen.json", ["/repo/places/lobby"]),
			]);

			expect(plan.configsFor("/repo/places/lobby/A.luau")).toEqual([
				"/repo/lobby.rogen.json",
			]);
		});

		it("should claim a root directory itself", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(plan.configsFor("/repo/src")).toEqual([
				"/repo/default.rogen.json",
			]);
		});

		it("should not claim a sibling that shares a name prefix", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(plan.configsFor("/repo/src-old/A.luau")).toEqual([]);
		});

		it("should claim a path outside the config's own directory", () => {
			const plan = createWatchPlan([
				config("/repo/places/lobby.rogen.json", ["/repo/shared"]),
			]);

			expect(plan.configsFor("/repo/shared/A.luau")).toEqual([
				"/repo/places/lobby.rogen.json",
			]);
		});
	});

	describe("watches", () => {
		it("should be true only under a root", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(plan.watches("/repo/src/A.luau")).toBe(true);
			expect(plan.watches("/repo/default.rogen.json")).toBe(false);
		});
	});

	describe("ignored", () => {
		it("should list each output file, its sync directory and a pattern for its staging files", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"], {
					syncDir: "/repo/out",
				}),
			]);

			expect(plan.ignored).toEqual([
				"/repo/default.project.json",
				"/repo/out",
				expect.any(RegExp),
			]);
		});

		it("should ignore the staging file of any process writing an output", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(
				isIgnored(
					"/repo/default.project.json.1234-abcd.tmp",
					plan.ignored
				)
			).toBe(true);
			expect(isIgnored("/repo/default.project.json", plan.ignored)).toBe(
				true
			);
		});

		it("should not ignore the staging file of an unrelated output", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(
				isIgnored("/repo/other.project.json.1234.tmp", plan.ignored)
			).toBe(false);
			expect(isIgnored("/repo/src/A.tmp", plan.ignored)).toBe(false);
		});

		it("should escape regex characters in the output path", () => {
			const plan = createWatchPlan([
				config("/repo (v2)/default.rogen.json", ["/repo (v2)/src"]),
			]);

			expect(
				isIgnored("/repo (v2)/default.project.json.1.tmp", plan.ignored)
			).toBe(true);
			expect(
				isIgnored("/repoXv2)/default.project.json.1.tmp", plan.ignored)
			).toBe(false);
		});

		it("should keep a sync directory that lies inside a root", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"], {
					syncDir: "/repo/src/out",
				}),
			]);

			expect(plan.ignored).toContain("/repo/src/out");
		});

		it("should drop a sync directory that contains a root", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/dist/src"], {
					syncDir: "/repo/dist",
				}),
			]);

			expect(plan.ignored).not.toContain("/repo/dist");
		});

		it("should list a path shared by two configs once", () => {
			const plan = createWatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"], {
					syncDir: "/repo/out",
				}),
				config("/repo/source.rogen.json", ["/repo/src"], {
					syncDir: "/repo/out",
				}),
			]);

			expect(plan.ignored.filter((p) => p === "/repo/out")).toHaveLength(
				1
			);
			expect(
				plan.ignored.filter((p) => p instanceof RegExp)
			).toHaveLength(2);
		});
	});
});
