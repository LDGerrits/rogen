import { SyncTool } from "../../toolchain/toolchain.js";
import { SyncLayout } from "../sync-layout.js";
import { commonAncestor } from "../../../base/path.js";
import { abs, configOf, syncTools } from "./fixtures.js";

interface LayoutSpec {
	readonly commonRoot: string;
	readonly syncPath?: string;
	readonly projectDir: string;
	readonly tools: readonly SyncTool[];
}

const layoutOf = ({ tools, ...config }: LayoutSpec) =>
	new SyncLayout(config, tools);

describe("SyncLayout", () => {
	it("should take the project dir from the config's folder and the common root from the source paths", () => {
		const layout = new SyncLayout(
			configOf({
				sourcePaths: [abs("src/server"), abs("src/shared")],
				syncPath: abs("out"),
				file: abs("game/rogen.json"),
			}),
			syncTools
		);

		expect(layout).toMatchObject({
			commonRoot: abs("src"),
			syncPath: abs("out"),
			projectDir: abs("game"),
		});
	});

	it("should leave the sync path out when there is none", () => {
		const layout = new SyncLayout(
			configOf({ sourcePaths: [abs("src")] }),
			syncTools
		);

		expect(layout.syncPath).toBeUndefined();
	});

	it("should build in the project dir when there are no source paths", () => {
		const layout = new SyncLayout(configOf({ sourcePaths: [] }), syncTools);

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

		it("should replace a single source path with the sync path", () => {
			const layout = layoutOf({
				commonRoot: commonAncestor([abs("src")]),
				syncPath: abs("out"),
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
				syncPath: abs("out"),
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
				syncPath: abs("out"),
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
				syncPath: abs("out"),
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
				syncPath: abs("out"),
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
				syncPath: abs("out"),
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
				syncPath: abs("out"),
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
				syncPath: abs("out"),
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
				syncPath: abs("out"),
				projectDir,
				tools: syncTools,
			});

			expect(layout.rojoPath(abs("src/Inventory"))).toEqual({
				optional: "out/Inventory",
			});
		});

		describe("without a sync path", () => {
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

		it("should leave a glob alone without a sync path", () => {
			const layout = layoutOf({
				commonRoot: abs(""),
				projectDir,
				tools: syncTools,
			});

			expect(layout.syncedGlob("../../**/*.spec.luau")).toBe(
				"../../**/*.spec.luau"
			);
		});

		it("should move a glob inside the common root to the sync path", () => {
			const layout = layoutOf({
				commonRoot: abs(""),
				syncPath: abs("places/lobby/dist"),
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
				syncPath: abs("dist"),
				projectDir: abs(""),
				tools: syncTools,
			});

			expect(layout.syncedGlob("**/*.spec.luau")).toBe("**/*.spec.luau");
			expect(layout.syncedGlob("docs/**")).toBe("docs/**");
		});

		it("should replace the common root of a single source path", () => {
			const layout = layoutOf({
				commonRoot: abs("src"),
				syncPath: abs("dist"),
				projectDir: abs(""),
				tools: syncTools,
			});

			expect(layout.syncedGlob("src/**/*.md")).toBe("dist/**/*.md");
		});
	});
});
