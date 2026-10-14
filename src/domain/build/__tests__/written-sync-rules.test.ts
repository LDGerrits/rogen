import { SyncRule } from "../../rojo/sync-rules.js";
import { SyncLayout } from "../sync-layout.js";
import { WrittenSyncRules } from "../written-sync-rules.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { abs, configOf, syncTools } from "./fixtures.js";

const module: SyncRule = {
	pattern: "src/*.module",
	use: "moduleScript",
	suffix: ".module",
};

const writtenBy = (
	rules: readonly object[],
	sources: readonly string[] = [],
	overrides: ResolvedConfigSpec = {}
) => {
	const config = configOf({
		project: { tree: {}, syncRules: rules },
		...overrides,
	});
	return new WrittenSyncRules(config, new SyncLayout(config, syncTools)).of(
		sources.map((source) => abs(source))
	);
};

describe("WrittenSyncRules", () => {
	it("should write the rules as they are when nothing is moved", () => {
		expect(writtenBy([module])).toEqual([module]);
	});

	it("should write a pattern it need not move as it is", () => {
		const rule: SyncRule = { pattern: "{src,lib}/*.md", use: "text" };

		expect(writtenBy([rule], ["src/A.md"])).toEqual([rule]);
	});

	it("should write nothing for a project without rules", () => {
		expect(writtenBy([])).toEqual([]);
	});

	it("should move a pattern that begins with a folder under the sync path", () => {
		expect(writtenBy([module], [], { syncPath: abs("out") })).toEqual([
			{ ...module, pattern: "out/*.module" },
		]);
	});

	it("should move the exclude with the pattern", () => {
		expect(
			writtenBy([{ ...module, exclude: "src/*.spec.module" }], [], {
				syncPath: abs("out"),
			})
		).toEqual([
			{
				...module,
				pattern: "out/*.module",
				exclude: "out/*.spec.module",
			},
		]);
	});

	it("should leave a pattern that begins with a wildcard where it is", () => {
		const rule: SyncRule = { pattern: "**/*.note", use: "text" };

		expect(writtenBy([rule], [], { syncPath: abs("out") })).toEqual([rule]);
	});

	it("should move a pattern from the folder its rule was written in", () => {
		expect(
			writtenBy([{ ...module, origin: abs("") }], [], {
				file: abs("places/lobby/rogen.json"),
			})
		).toEqual([{ ...module, pattern: "../../src/*.module" }]);
	});

	it("should write a literal rule for each file a pattern that can't be moved takes", () => {
		const rule: SyncRule = {
			pattern: "{src,lib}/*.module",
			use: "moduleScript",
			suffix: ".module",
		};

		expect(
			writtenBy([rule], ["src/A.module", "src/B.module", "src/C.luau"], {
				syncPath: abs("out"),
			})
		).toEqual([
			{
				pattern: "out/A.module",
				use: "moduleScript",
				suffix: ".module",
			},
			{
				pattern: "out/B.module",
				use: "moduleScript",
				suffix: ".module",
			},
		]);
	});

	it("should escape what a glob would read in the path of a file", () => {
		const rule: SyncRule = { pattern: "{src}/*.md", use: "text" };

		expect(
			writtenBy([rule], ["src/[A].md"], { syncPath: abs("out") })
		).toEqual([{ pattern: "out/[[]A[]].md", use: "text" }]);
	});

	it("should write a literal rule only for a file its own rule takes first", () => {
		const first: SyncRule = { pattern: "src/A.md", use: "json" };
		const second: SyncRule = { pattern: "{src}/*.md", use: "text" };

		expect(
			writtenBy([first, second], ["src/A.md", "src/B.md"], {
				syncPath: abs("out"),
			})
		).toEqual([
			{ ...first, pattern: "out/A.md" },
			{ pattern: "out/B.md", use: "text" },
		]);
	});
});
