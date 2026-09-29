import path from "path";
import { BuildSummary } from "../../../domain/build/build-service.js";
import { describeBuild } from "../describe-build.js";

const cwd = path.resolve("/repo");

const summaryOf = (overrides: Partial<BuildSummary> = {}): BuildSummary => ({
	roots: [],
	routes: [],
	tags: [],
	unrouted: 0,
	superseded: 0,
	displaced: 0,
	...overrides,
});

describe("describeBuild", () => {
	it("should name each root dir relative to the working directory", () => {
		expect(
			describeBuild(
				summaryOf({
					roots: [
						{
							rootDir: path.join(cwd, "src"),
							files: 3,
							excluded: 0,
							skippedLinks: 0,
						},
						{
							rootDir: path.join(cwd, "lib"),
							files: 1,
							excluded: 2,
							skippedLinks: 1,
						},
					],
				}),
				cwd
			)
		).toEqual(["src: 3 files", "lib: 1 file, 2 excluded, 1 skipped link"]);
	});

	it("should give each route its target and file count", () => {
		expect(
			describeBuild(
				summaryOf({
					routes: [
						{
							key: "server",
							target: "ServerScriptService",
							files: 1,
						},
						{ key: "*", target: "ReplicatedStorage", files: 0 },
					],
				}),
				cwd
			)
		).toEqual([
			"route server -> ServerScriptService: 1 file",
			"route * -> ReplicatedStorage: 0 files",
		]);
	});

	it("should say which tags are on and which left files out", () => {
		expect(
			describeBuild(
				summaryOf({
					tags: [
						{ tag: "mock", on: true, files: 2 },
						{ tag: "debug", on: false, files: 1 },
					],
				}),
				cwd
			)
		).toEqual(["tag mock on: 2 files", "tag debug off: 1 file left out"]);
	});

	it("should count what was left out only when something was", () => {
		expect(describeBuild(summaryOf(), cwd)).toEqual([]);
		expect(
			describeBuild(
				summaryOf({ unrouted: 2, superseded: 1, displaced: 3 }),
				cwd
			)
		).toEqual([
			"left out: 2 unrouted, 1 replaced by a file with the same name, 3 displaced by the template",
		]);
	});
});
