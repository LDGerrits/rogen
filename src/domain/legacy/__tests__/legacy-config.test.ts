import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { LegacyConfig } from "../legacy-config.js";

describe("LegacyConfig", () => {
	describe("detects", () => {
		it("should recognise the keys only a v1 config has", () => {
			for (const key of ["source", "aliases"])
				expect(LegacyConfig.detects({ [key]: [] })).toBe(true);
		});

		it("should recognise a mode by its output or build", () => {
			expect(LegacyConfig.detects({ luau: { output: "a.json" } })).toBe(
				true
			);
			expect(LegacyConfig.detects({ ts: { build: "src" } })).toBe(true);
		});

		it("should not recognise a v2 config", () => {
			expect(
				LegacyConfig.detects({
					sourcePaths: ["src"],
					routes: { server: "ServerScriptService" },
					globIgnorePaths: ["**/*.spec.luau"],
					tree: { $className: "DataModel" },
				})
			).toBe(false);
		});

		it("should not take a route, a tree node or a project named build or output for a Rogen 1 mode", () => {
			for (const key of ["routes", "tree", "projects"])
				expect(
					LegacyConfig.detects({
						sourcePaths: ["src"],
						[key]: { build: "ServerStorage", output: "Workspace" },
					})
				).toBe(false);
		});

		it("should not recognise what isn't an object", () => {
			for (const value of [undefined, null, "source", 3, ["source"]])
				expect(LegacyConfig.detects(value)).toBe(false);
		});
	});

	describe("check", () => {
		it("should point to the migration page for a v1 config", () => {
			const [hint, ...others] = LegacyConfig.check({
				file: "/repo/.rogen.json",
				value: { source: ["src"] },
			});

			expect(others).toEqual([]);
			expect(hint).toMatchObject({
				severity: DiagnosticSeverity.Error,
				code: "legacy.config",
				resource: "/repo/.rogen.json",
			});
			expect(hint.message).toContain(LegacyConfig.MIGRATION_URL);
		});

		it("should say nothing about any other file", () => {
			expect(
				LegacyConfig.check({ file: "/repo/a.rogen.json", value: {} })
			).toEqual([]);
			expect(
				LegacyConfig.check({
					file: "/repo/a.rogen.json",
					value: undefined,
				})
			).toEqual([]);
		});
	});

	describe("find", () => {
		let fs: MemoryFileSystemService;

		beforeEach(async () => {
			fs = new MemoryFileSystemService();
			await fs.createDirectory("/repo");
		});

		it.each([".rogen.json", "rogen.json", "game.rogen.jsonc"])(
			"should point to the migration page for a v1 %s",
			async (name) => {
				await fs.writeFile(
					`/repo/${name}`,
					'{ "source": ["src"] } // v1'
				);

				const [hint, ...others] = await LegacyConfig.find("/repo", fs);

				expect(others).toEqual([]);
				expect(hint).toMatchObject({
					code: "legacy.config",
					resource: `/repo/${name}`,
				});
				expect(hint.message).toContain(LegacyConfig.MIGRATION_URL);
			}
		);

		it("should say nothing of a file without v1 keys, one that isn't JSON or one of another name", async () => {
			await fs.writeFile("/repo/.rogen.json", '{ "sourcePaths": [] }');
			await fs.writeFile("/repo/rogen.json", "not json");
			await fs.writeFile("/repo/notes.json", '{ "source": [] }');

			expect(await LegacyConfig.find("/repo", fs)).toEqual([]);
		});

		it("should say nothing of a folder that can't be read", async () => {
			expect(await LegacyConfig.find("/missing", fs)).toEqual([]);
		});
	});
});
