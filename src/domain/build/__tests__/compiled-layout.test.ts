import { SyncTool } from "../../toolchain/toolchain.js";
import { CompiledLayout } from "../compiled-layout.js";
import { commonAncestor } from "../../../base/path.js";
import { abs, configOf, syncTools } from "./fixtures.js";

interface LayoutSpec {
	readonly commonRoot: string;
	readonly compiledPath?: string;
	readonly projectDir: string;
	readonly tools: readonly SyncTool[];
}

const layoutOf = ({ tools, ...config }: LayoutSpec) =>
	new CompiledLayout(config, tools);

describe("CompiledLayout", () => {
	it("should take the project dir from the config's folder and the common root from the source paths", () => {
		const layout = new CompiledLayout(
			configOf({
				sourcePaths: [abs("src/server"), abs("src/shared")],
				compiledPath: abs("out"),
				file: abs("game/default.rogen.json"),
			}),
			syncTools
		);

		expect(layout).toMatchObject({
			commonRoot: abs("src"),
			compiledPath: abs("out"),
			projectDir: abs("game"),
		});
	});

	it("should repeat the layout of the source paths under their common folder", () => {
		const several = new CompiledLayout(
			configOf({
				sourcePaths: [
					abs("places/shared/src"),
					abs("places/lobby/src"),
				],
				compiledPath: abs("places/lobby/out"),
				file: abs("places/lobby/default.rogen.json"),
			}),
			[]
		);
		const one = new CompiledLayout(
			configOf({
				sourcePaths: [abs("src")],
				compiledPath: abs("out"),
			}),
			[]
		);

		expect(several.compiledOf(abs("places/shared/src"))).toBe(
			abs("places/lobby/out/shared/src")
		);
		expect(several.compiledOf(abs("places/lobby/src/Foo.luau"))).toBe(
			abs("places/lobby/out/lobby/src/Foo.luau")
		);
		expect(one.compiledOf(abs("src/Foo.luau"))).toBe(abs("out/Foo.luau"));
	});

	it("should leave the compiled path out when there is none", () => {
		const layout = new CompiledLayout(
			configOf({ sourcePaths: [abs("src")] }),
			syncTools
		);

		expect(layout.compiledPath).toBeUndefined();
	});

	it("should build in the project dir when there are no source paths", () => {
		const layout = new CompiledLayout(
			configOf({ sourcePaths: [] }),
			syncTools
		);

		expect(layout.commonRoot).toBe(abs("."));
	});

	it("should say which tools convert a meta file and to what", () => {
		expect(
			new CompiledLayout(configOf(), syncTools).metaReplacements
		).toEqual([
			{
				suffix: ".meta.lua",
				note: "Darklua converts every .meta.json this way.",
			},
		]);
	});

	it("should know which sources a tool only reads", () => {
		const layout = new CompiledLayout(configOf(), syncTools);

		expect(layout.isReadOnly(abs("src/types.d.ts"))).toBe(true);
		expect(layout.isReadOnly(abs("src/Foo.ts"))).toBe(false);
	});

	describe("relativeToProject", () => {
		it("should write posix separators", () => {
			const layout = new CompiledLayout(configOf(), syncTools);

			expect(layout.relativeToProject(abs("roblox_packages/lib"))).toBe(
				"roblox_packages/lib"
			);
		});
	});

	describe("compiledPath", () => {
		const projectDir = abs(".");

		it("should replace a single source path with the compiled path", () => {
			const layout = layoutOf({
				commonRoot: commonAncestor([abs("src")]),
				compiledPath: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.rojoPath(abs("src/Foo.ts"))).toEqual({
				optional: "out/Foo.luau",
			});
		});

		it("should keep the distinguishing part of each source path when there are several", () => {
			const layout = layoutOf({
				commonRoot: commonAncestor([abs("core"), abs("lobby")]),
				compiledPath: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.rojoPath(abs("core/Foo.luau"))).toEqual({
				optional: "out/core/Foo.luau",
			});
			expect(layout.rojoPath(abs("lobby/Bar.luau"))).toEqual({
				optional: "out/lobby/Bar.luau",
			});
		});

		it("should emit what rbxtsc writes for a multi-place repo", () => {
			const layout = layoutOf({
				commonRoot: commonAncestor([
					abs("places/main/src"),
					abs("places/main/tests"),
					abs("places/common/src"),
					abs("places/common/test"),
				]),
				compiledPath: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.rojoPath(abs("places/main/src/server"))).toEqual({
				optional: "out/main/src/server",
			});
			expect(layout.rojoPath(abs("places/common/src/server"))).toEqual({
				optional: "out/common/src/server",
			});
			expect(
				layout.rojoPath(abs("places/common/test/tests/server"))
			).toEqual({ optional: "out/common/test/tests/server" });
		});

		it("should emit a path relative to the project file's directory", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				compiledPath: abs("out"),
				projectDir: abs("places/main"),
				tools: syncTools,
			});

			expect(layout.rojoPath(abs("src/Foo.luau"))).toEqual({
				optional: "../../out/Foo.luau",
			});
		});

		it("should rewrite .ts and .tsx to .luau", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				compiledPath: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.rojoPath(abs("src/A.ts"))).toEqual({
				optional: "out/A.luau",
			});
			expect(layout.rojoPath(abs("src/ui/B.tsx"))).toEqual({
				optional: "out/ui/B.luau",
			});
		});

		it("should rewrite nothing when no processor contributes", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				compiledPath: abs("out"),
				projectDir,
				tools: [],
			});

			expect(layout.rojoPath(abs("src/A.ts"))).toEqual({
				optional: "out/A.ts",
			});
		});

		it("should apply whatever a processor contributes", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				compiledPath: abs("out"),
				projectDir,
				tools: [
					{ id: "minify", emittedPath: (p: string) => `${p}.min` },
				],
			});

			expect(layout.rojoPath(abs("src/A.luau"))).toEqual({
				optional: "out/A.luau.min",
			});
		});

		it("should not rewrite any other extension", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				compiledPath: abs("out"),
				projectDir,
				tools: syncTools,
			});

			for (const name of [
				"A.luau",
				"A.lua",
				"A.rbxm",
				"A.json",
				"A.tsx.bak",
				"A.mts",
			]) {
				expect(layout.rojoPath(abs("src", name))).toEqual({
					optional: `out/${name}`,
				});
			}
		});

		it("should leave directories untouched apart from the root swap", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				compiledPath: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.rojoPath(abs("src/Inventory"))).toEqual({
				optional: "out/Inventory",
			});
		});

		describe("without a compiled path", () => {
			it("should point at the real path relative to the project file", () => {
				const layout = layoutOf({
					commonRoot: abs("src"),
					projectDir,
					tools: syncTools,
				});

				expect(layout.rojoPath(abs("src/Foo.luau"))).toEqual({
					optional: "src/Foo.luau",
				});
			});

			it("should include ../ when the source is outside the project file's directory", () => {
				const layout = layoutOf({
					commonRoot: abs("places/common/src"),
					projectDir: abs("places/main"),
					tools: syncTools,
				});

				expect(
					layout.rojoPath(abs("places/common/src/Foo.luau"))
				).toEqual({ optional: "../common/src/Foo.luau" });
			});

			it("should not rewrite .ts", () => {
				const layout = layoutOf({
					commonRoot: abs("src"),
					projectDir,
					tools: syncTools,
				});

				expect(layout.rojoPath(abs("src/Foo.ts"))).toEqual({
					optional: "src/Foo.ts",
				});
			});
		});
	});
	describe("syncedGlob", () => {
		const projectDir = abs("places/lobby");

		it("should leave a glob alone without a compiled path", () => {
			const layout = layoutOf({
				commonRoot: abs(""),
				projectDir,
				tools: syncTools,
			});

			expect(layout.syncedGlob("../../**/*.spec.luau")).toBe(
				"../../**/*.spec.luau"
			);
		});

		it("should move a glob inside the common root to the compiled path", () => {
			const layout = layoutOf({
				commonRoot: abs(""),
				compiledPath: abs("places/lobby/dist"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.syncedGlob("../../src/**/*.md")).toBe(
				"dist/src/**/*.md"
			);
			expect(layout.syncedGlob("../../**/*.spec.luau")).toBe(
				"dist/**/*.spec.luau"
			);
		});

		it("should leave a glob outside the common root alone", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				compiledPath: abs("dist"),
				projectDir: abs(""),
				tools: syncTools,
			});

			expect(layout.syncedGlob("**/*.spec.luau")).toBe("**/*.spec.luau");
			expect(layout.syncedGlob("docs/**")).toBe("docs/**");
		});

		it("should replace the common root of a single source path", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				compiledPath: abs("dist"),
				projectDir: abs(""),
				tools: syncTools,
			});

			expect(layout.syncedGlob("src/**/*.md")).toBe("dist/**/*.md");
		});
	});
});
