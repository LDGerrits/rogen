import { RojoFile } from "../../rojo/rojo.js";
import { SyncRule } from "../../rojo/sync-rules.js";
import { ScannedFile } from "../root-scanner.js";
import { CompiledLayout } from "../compiled-layout.js";
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
	mounts: readonly string[] = [],
	legacyClients: readonly string[] = []
) => {
	const config = configOf({
		project: { tree: {}, syncRules: rules },
		...overrides,
	});
	const layout = new CompiledLayout(config, syncTools);
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
	).of(entries, new Set(legacyClients.map((source) => abs(source))));
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
			writtenBy([rule], ["src/A.module"], { compiledPath: abs("out") })
		).toEqual([{ pattern: "out/A.module", use: "moduleScript" }]);
	});

	it("should write a pattern it need not move as it is", () => {
		const rule: SyncRule = { pattern: "{src,lib}/*.md", use: "text" };

		expect(writtenBy([rule], ["src/A.md"])).toEqual([rule]);
	});

	it("should write nothing for a project without rules", () => {
		expect(writtenBy([])).toEqual([]);
	});

	describe("legacy client scripts", () => {
		it("should write a literal rule that keeps each client script a LocalScript, after the project's own", () => {
			expect(
				writtenBy(
					[module],
					[],
					{},
					[],
					["src/Hud.client.luau", "src/ui/Bar.client.lua"]
				)
			).toEqual([
				module,
				{
					pattern: "src/Hud.client.luau",
					use: "legacyClientScript",
					suffix: ".client.luau",
				},
				{
					pattern: "src/ui/Bar.client.lua",
					use: "legacyClientScript",
					suffix: ".client.lua",
				},
			]);
		});

		it("should write the rule for the file a tool emits under the compiled path", () => {
			expect(
				writtenBy(
					[],
					[],
					{ compiledPath: abs("out") },
					[],
					["src/Hud.client.luau"]
				)
			).toEqual([
				{
					pattern: "out/Hud.client.luau",
					use: "legacyClientScript",
					suffix: ".client.luau",
				},
			]);
		});

		it("should escape the characters of a file name that a glob reads", () => {
			const [rule] = writtenBy([], [], {}, [], ["src/[A].client.luau"]);

			expect(rule.pattern).toBe("src/[[]A[]].client.luau");
		});
	});

	it("should move a pattern that begins with a folder under the compiled path", () => {
		expect(writtenBy([module], [], { compiledPath: abs("out") })).toEqual([
			{ ...module, pattern: "out/*.module" },
		]);
	});

	it("should move the exclude with the pattern", () => {
		expect(
			writtenBy([{ ...module, exclude: "src/*.spec.module" }], [], {
				compiledPath: abs("out"),
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

		expect(writtenBy([rule], [], { compiledPath: abs("out") })).toEqual([
			rule,
		]);
	});

	it("should write a literal rule for each file a pattern that can't be moved takes", () => {
		const rule: SyncRule = {
			pattern: "{src,lib}/*.module",
			use: "moduleScript",
			suffix: ".module",
		};

		expect(
			writtenBy([rule], ["src/A.module", "src/B.module", "src/C.luau"], {
				compiledPath: abs("out"),
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
			writtenBy([rule], ["src/[A].md"], { compiledPath: abs("out") })
		).toEqual([{ pattern: "out/[[]A[]].md", use: "text" }]);
	});

	it("should write a literal rule only for a file its own rule takes first", () => {
		const first: SyncRule = { pattern: "src/A.md", use: "json" };
		const second: SyncRule = { pattern: "{src}/*.md", use: "text" };

		expect(
			writtenBy([first, second], ["src/A.md", "src/B.md"], {
				compiledPath: abs("out"),
			})
		).toEqual([
			{ ...first, pattern: "out/A.md" },
			{ pattern: "out/B.md", use: "text" },
		]);
	});

	it("should keep the rule as it was where a mount lies under its old place", () => {
		expect(
			writtenBy([module], [], { compiledPath: abs("out") }, [
				"src/Vendor",
			])
		).toEqual([{ ...module, pattern: "out/*.module" }, module]);
	});

	it("should not keep the rule as it was for a mount elsewhere", () => {
		expect(
			writtenBy([module], [], { compiledPath: abs("out") }, ["vendor"])
		).toEqual([{ ...module, pattern: "out/*.module" }]);
	});

	it("should keep a pattern it can't move as it was where a mount lies", () => {
		const rule: SyncRule = { pattern: "{src,lib}/*.md", use: "text" };

		expect(
			writtenBy([rule], ["src/A.md"], { compiledPath: abs("out") }, [
				"src/Vendor",
			])
		).toEqual([{ pattern: "out/A.md", use: "text" }, rule]);
	});
});
