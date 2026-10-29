import path from "path";
import { IgnoredPath, WatchFilter } from "../../../platform/watcher/watcher.js";
import { mockConfig } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { WatchPlan } from "../watch-plan.js";

const isIgnored = (target: string, ignored: readonly IgnoredPath[]) =>
	new WatchFilter([], { ignored }).skips(target);

const config = (
	file: string,
	sourcePaths: string[],
	extra: { compiledPath?: string } = {}
): ResolvedConfig =>
	mockConfig({
		file,
		sourcePaths,
		routes: { "*": "ReplicatedStorage" },
		...extra,
	});

describe("domain/watch/watch-plan", () => {
	describe("roots", () => {
		it("should list a root shared by two configs once", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
				config("/repo/arena/default.rogen.json", ["/repo/src"]),
			]);

			expect(plan.roots).toEqual(["/repo/src"]);
		});

		it("should drop a root inside another", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
				config("/repo/lobby/default.rogen.json", ["/repo/src/shared"]),
			]);

			expect(plan.roots).toEqual(["/repo/src"]);
		});

		it("should not widen roots to their common parent", () => {
			const plan = new WatchPlan([
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

		it("should keep roots that only share a name prefix", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", [
					"/repo/src",
					"/repo/src-extra",
				]),
			]);

			expect(plan.roots).toEqual(["/repo/src", "/repo/src-extra"]);
		});

		it("should drop a nested root even when it comes first", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", [
					"/repo/src/shared",
					"/repo/src",
				]),
			]);

			expect(plan.roots).toEqual(["/repo/src"]);
		});

		it("should watch the src folder beside a config that declares no routes", () => {
			const plan = new WatchPlan([
				mockConfig({ file: "/repo/lobby/default.rogen.json" }),
			]);

			expect(plan.roots).toEqual(["/repo/lobby/src"]);
			expect(plan.projectsFor("/repo/lobby/src/A.luau")).toEqual([
				"/repo/lobby/default.project.json",
			]);
		});

		it("should resolve relative roots to absolute ones", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["src"]),
			]);

			expect(plan.roots).toEqual([path.resolve("src")]);
		});
	});

	describe("projectsFor", () => {
		it("should return every config whose roots contain the path", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
				config("/repo/lobby/default.rogen.json", ["/repo/src/shared"]),
			]);

			expect(plan.projectsFor("/repo/src/shared/A.luau")).toEqual([
				"/repo/default.project.json",
				"/repo/lobby/default.project.json",
			]);
		});

		it("should return a config once when several of its roots contain the path", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", [
					"/repo/src",
					"/repo/src/shared",
				]),
			]);

			expect(plan.projectsFor("/repo/src/shared/A.luau")).toEqual([
				"/repo/default.project.json",
			]);
		});

		it("should skip a config whose roots do not contain the path", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
				config("/repo/lobby/default.rogen.json", [
					"/repo/places/lobby",
				]),
			]);

			expect(plan.projectsFor("/repo/places/lobby/A.luau")).toEqual([
				"/repo/lobby/default.project.json",
			]);
		});

		it("should claim a source path itself", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(plan.projectsFor("/repo/src")).toEqual([
				"/repo/default.project.json",
			]);
		});

		it("should not claim a sibling that shares a name prefix", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(plan.projectsFor("/repo/src-old/A.luau")).toEqual([]);
		});

		it("should claim a path outside the config's own directory", () => {
			const plan = new WatchPlan([
				config("/repo/places/lobby/default.rogen.json", [
					"/repo/shared",
				]),
			]);

			expect(plan.projectsFor("/repo/shared/A.luau")).toEqual([
				"/repo/places/lobby/default.project.json",
			]);
		});
	});

	describe("watches", () => {
		it("should be true only under a root", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(plan.watches("/repo/src/A.luau")).toBe(true);
			expect(plan.watches("/repo/default.rogen.json")).toBe(false);
		});
	});

	describe("compiled paths", () => {
		it("should watch a compiled path two configs share once", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"], {
					compiledPath: "/repo/out",
				}),
				config("/repo/arena/default.rogen.json", ["/repo/src"], {
					compiledPath: "/repo/out",
				}),
			]);

			expect(plan.compiledRoots).toEqual(["/repo/out"]);
			expect(plan.compiledFor("/repo/out/A.luau")).toEqual([
				"/repo/default.project.json",
				"/repo/arena/default.project.json",
			]);
		});

		it("should leave a compiled path inside a root to the root, which ignores it", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"], {
					compiledPath: "/repo/src/out",
				}),
			]);

			expect(plan.compiledRoots).toEqual([]);
			expect(plan.compiledFor("/repo/src/out/A.luau")).toEqual([]);
		});

		it("should not take a source file for compiled output in a compiled path that holds the root", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/dist/src"], {
					compiledPath: "/repo/dist",
				}),
			]);

			expect(plan.compiledFor("/repo/dist/src/A.luau")).toEqual([]);
			expect(plan.compiledFor("/repo/dist/A.luau")).toEqual([
				"/repo/default.project.json",
			]);
		});
	});

	describe("ignored", () => {
		it("should list each output file and a pattern for its staging files, but not the compiled path", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"], {
					compiledPath: "/repo/out",
				}),
			]);

			expect(plan.ignored).toEqual([
				"/repo/default.project.json",
				"/repo/rogen-syncback.project.json",
				"/repo/.rogen-syncback",
				expect.any(RegExp),
			]);
		});

		it("should ignore what syncback writes beside the config while it runs", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo"]),
			]);

			expect(
				isIgnored("/repo/rogen-syncback.project.json", plan.ignored)
			).toBe(true);
			expect(
				isIgnored("/repo/.rogen-syncback/new/0/A.luau", plan.ignored)
			).toBe(true);
		});

		it("should not ignore a Rojo project file that is the config itself", () => {
			const plan = new WatchPlan([
				config("/repo/default.project.json", ["/repo/src"]),
			]);

			expect(isIgnored("/repo/default.project.json", plan.ignored)).toBe(
				false
			);
		});

		it("should ignore the staging file of any process writing an output", () => {
			const plan = new WatchPlan([
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
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"]),
			]);

			expect(
				isIgnored("/repo/other.project.json.1234.tmp", plan.ignored)
			).toBe(false);
			expect(isIgnored("/repo/src/A.tmp", plan.ignored)).toBe(false);
		});

		it("should escape regex characters in the output path", () => {
			const plan = new WatchPlan([
				config("/repo (x)/default.rogen.json", ["/repo (x)/src"]),
			]);

			expect(
				isIgnored("/repo (x)/default.project.json.1.tmp", plan.ignored)
			).toBe(true);
			expect(
				isIgnored("/repoXx)/default.project.json.1.tmp", plan.ignored)
			).toBe(false);
		});

		it("should keep a compiled path that lies inside a root", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"], {
					compiledPath: "/repo/src/out",
				}),
			]);

			expect(plan.ignored).toContain("/repo/src/out");
		});

		it("should drop a compiled path that contains a root", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/dist/src"], {
					compiledPath: "/repo/dist",
				}),
			]);

			expect(plan.ignored).not.toContain("/repo/dist");
		});

		it("should list a path shared by two configs once", () => {
			const plan = new WatchPlan([
				config("/repo/default.rogen.json", ["/repo/src"], {
					compiledPath: "/repo/src/out",
				}),
				config("/repo/arena/default.rogen.json", ["/repo/src"], {
					compiledPath: "/repo/src/out",
				}),
			]);

			expect(
				plan.ignored.filter((p) => p === "/repo/src/out")
			).toHaveLength(1);
			expect(
				plan.ignored.filter((p) => p instanceof RegExp)
			).toHaveLength(2);
		});
	});
});
