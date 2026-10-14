import { RojoFile } from "../../rojo/rojo.js";
import { SyncRule } from "../../rojo/sync-rules.js";
import { ScannedFile } from "../root-scanner.js";
import { SyncLayout } from "../sync-layout.js";
import { WrittenGlobs } from "../written-globs.js";
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
	overrides: ResolvedConfigSpec = {},
	mounts: readonly string[] = []
) => {
	const config = configOf({
		project: { tree: {}, syncRules: rules },
		...overrides,
	});
	const layout = new SyncLayout(config, syncTools);
	const entries: ScannedFile[] = sources.map((source) => ({
		kind: "data",
		file: RojoFile.at(abs(source), config.syncRules),
		sourcePath: abs("src"),
		relativePath: source,
		source: abs(source),
	}));
	return new WrittenSyncRules(
		config,
		layout,
		new WrittenGlobs(
			layout,
			mounts.map((mount) => abs(mount))
		)
	).of(entries);
};

describe("WrittenSyncRules", () => {
	it("should write the rules as they are when nothing is moved", () => {
		expect(writtenBy([module])).toEqual([module]);
	});

	it("should write literal rules when a wildcard pattern would miss the moved files", () => {
		const rule: SyncRule = {
			pattern: "**/src/*.module",
			use: "moduleScript",
		};

		expect(
			writtenBy([rule], ["src/A.module"], { syncPath: abs("out") })
		).toEqual([{ pattern: "out/A.module", use: "moduleScript" }]);
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
			writtenBy([module], [], {
				file: abs("places/lobby/rogen.json"),
				syncRulesDir: abs(""),
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

	it("should keep the rule as it was where a mount lies under its old place", () => {
		expect(
			writtenBy([module], [], { syncPath: abs("out") }, ["src/Vendor"])
		).toEqual([{ ...module, pattern: "out/*.module" }, module]);
	});

	it("should not keep the rule as it was for a mount elsewhere", () => {
		expect(
			writtenBy([module], [], { syncPath: abs("out") }, ["vendor"])
		).toEqual([{ ...module, pattern: "out/*.module" }]);
	});

	it("should keep a pattern it can't move as it was where a mount lies", () => {
		const rule: SyncRule = { pattern: "{src,lib}/*.md", use: "text" };

		expect(
			writtenBy([rule], ["src/A.md"], { syncPath: abs("out") }, [
				"src/Vendor",
			])
		).toEqual([{ pattern: "out/A.md", use: "text" }, rule]);
	});
});
