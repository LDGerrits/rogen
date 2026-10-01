import { SyncTool } from "../../toolchain/toolchain.js";
import { SyncLayout } from "../sync-layout.js";
import { commonAncestor } from "../../../base/path.js";
import { abs, configOf, syncTools } from "./fixtures.js";

interface LayoutSpec {
	readonly commonRoot: string;
	readonly syncDir?: string;
	readonly projectDir: string;
	readonly tools: readonly SyncTool[];
}

const layoutOf = ({ tools, ...config }: LayoutSpec) =>
	new SyncLayout(config, tools);

describe("SyncLayout", () => {
	it("should take the project dir from the out file and the common root from the root dirs", () => {
		const layout = new SyncLayout(
			configOf({
				rootDirs: [abs("src/server"), abs("src/shared")],
				syncDir: abs("out"),
				outFile: abs("game/default.project.json"),
			}),
			syncTools
		);

		expect(layout).toMatchObject({
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir: abs("game"),
		});
	});

	it("should leave the sync dir out when there is none", () => {
		const layout = new SyncLayout(
			configOf({ rootDirs: [abs("src")] }),
			syncTools
		);

		expect(layout.syncDir).toBeUndefined();
	});

	it("should build in the project dir when there are no root dirs", () => {
		const layout = new SyncLayout(configOf({ rootDirs: [] }), syncTools);

		expect(layout.commonRoot).toBe(abs("."));
	});

	it("should say which tools convert a meta file and to what", () => {
		expect(new SyncLayout(configOf(), syncTools).metaReplacements).toEqual([
			{
				suffix: ".meta.lua",
				note: "Darklua converts every .meta.json this way.",
			},
		]);
	});

	it("should know which sources a tool only reads", () => {
		const layout = new SyncLayout(configOf(), syncTools);

		expect(layout.isReadOnly(abs("src/types.d.ts"))).toBe(true);
		expect(layout.isReadOnly(abs("src/Foo.ts"))).toBe(false);
	});

	describe("relativeToProject", () => {
		it("should write posix separators", () => {
			const layout = new SyncLayout(configOf(), syncTools);

			expect(layout.relativeToProject(abs("roblox_packages/lib"))).toBe(
				"roblox_packages/lib"
			);
		});
	});

	describe("syncPath", () => {
		const projectDir = abs(".");

		it("should replace a single root dir with the sync dir", () => {
			const layout = layoutOf({
				commonRoot: commonAncestor([abs("src")]),
				syncDir: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.syncPath(abs("src/Foo.ts"))).toEqual({
				optional: "out/Foo.luau",
			});
		});

		it("should keep the distinguishing part of each root dir when there are several", () => {
			const layout = layoutOf({
				commonRoot: commonAncestor([abs("core"), abs("lobby")]),
				syncDir: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.syncPath(abs("core/Foo.luau"))).toEqual({
				optional: "out/core/Foo.luau",
			});
			expect(layout.syncPath(abs("lobby/Bar.luau"))).toEqual({
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
				syncDir: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.syncPath(abs("places/main/src/server"))).toEqual({
				optional: "out/main/src/server",
			});
			expect(layout.syncPath(abs("places/common/src/server"))).toEqual({
				optional: "out/common/src/server",
			});
			expect(
				layout.syncPath(abs("places/common/test/tests/server"))
			).toEqual({ optional: "out/common/test/tests/server" });
		});

		it("should emit a path relative to the project file's directory", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				syncDir: abs("out"),
				projectDir: abs("places/main"),
				tools: syncTools,
			});

			expect(layout.syncPath(abs("src/Foo.luau"))).toEqual({
				optional: "../../out/Foo.luau",
			});
		});

		it("should rewrite .ts and .tsx to .luau", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				syncDir: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.syncPath(abs("src/A.ts"))).toEqual({
				optional: "out/A.luau",
			});
			expect(layout.syncPath(abs("src/ui/B.tsx"))).toEqual({
				optional: "out/ui/B.luau",
			});
		});

		it("should rewrite nothing when no processor contributes", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				syncDir: abs("out"),
				projectDir,
				tools: [],
			});

			expect(layout.syncPath(abs("src/A.ts"))).toEqual({
				optional: "out/A.ts",
			});
		});

		it("should apply whatever a processor contributes", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				syncDir: abs("out"),
				projectDir,
				tools: [
					{ id: "minify", emittedPath: (p: string) => `${p}.min` },
				],
			});

			expect(layout.syncPath(abs("src/A.luau"))).toEqual({
				optional: "out/A.luau.min",
			});
		});

		it("should not rewrite any other extension", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				syncDir: abs("out"),
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
				expect(layout.syncPath(abs("src", name))).toEqual({
					optional: `out/${name}`,
				});
			}
		});

		it("should leave directories untouched apart from the root swap", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				syncDir: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.syncPath(abs("src/Inventory"))).toEqual({
				optional: "out/Inventory",
			});
		});

		describe("without a sync dir", () => {
			it("should point at the real path relative to the project file", () => {
				const layout = layoutOf({
					commonRoot: abs("src"),
					projectDir,
					tools: syncTools,
				});

				expect(layout.syncPath(abs("src/Foo.luau"))).toEqual({
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
					layout.syncPath(abs("places/common/src/Foo.luau"))
				).toEqual({ optional: "../common/src/Foo.luau" });
			});

			it("should not rewrite .ts", () => {
				const layout = layoutOf({
					commonRoot: abs("src"),
					projectDir,
					tools: syncTools,
				});

				expect(layout.syncPath(abs("src/Foo.ts"))).toEqual({
					optional: "src/Foo.ts",
				});
			});
		});
	});
});
