import "../config.js";
import { collapseConfig } from "../config-chain.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Result, ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../diagnostics/diagnostic.js";
import { CollapsedConfig } from "../config.js";

function diagnosticsOf(
	result: Result<CollapsedConfig, Diagnostic[]>
): Diagnostic[] {
	return (result as ResultError<Diagnostic[]>).error;
}

describe("domain/config/config-chain", () => {
	describe("collapseConfig", () => {
		let fs: MemoryFileSystemService;

		async function write(
			file: string,
			config: Record<string, unknown> | string
		): Promise<void> {
			await fs.writeFile(
				file,
				typeof config === "string" ? config : JSON.stringify(config)
			);
		}

		beforeEach(async () => {
			fs = new MemoryFileSystemService();
			await fs.createDirectory("/repo");
		});

		it("should return a config without extends as its own single-file chain", async () => {
			await write("/repo/default.rogen.json", {
				rootDirs: ["src"],
				routes: { server: "ServerScriptService" },
				syncDir: "out",
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap()).toEqual({
				file: "/repo/default.rogen.json",
				chain: ["/repo/default.rogen.json"],
				rootDirs: ["/repo/src"],
				routes: { server: "ServerScriptService" },
				syncDir: "/repo/out",
			});
		});

		it("should merge maps key by key with the child winning", async () => {
			await write("/repo/base.rogen.json", {
				routes: { server: "ServerScriptService", "*": "ServerStorage" },
				tags: { mock: false, debug: true },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				routes: {
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				tags: { mock: true },
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap().routes).toEqual({
				server: "ServerScriptService",
				"*": "ReplicatedStorage/shared",
				client: "StarterGui",
			});
			expect(result.unwrap().tags).toEqual({ mock: true, debug: true });
		});

		it("should replace lists wholesale instead of appending", async () => {
			await write("/repo/base.rogen.json", {
				rootDirs: ["core"],
				exclude: ["**/*.spec.luau", "**/*.story.luau"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["core", "places/lobby"],
				exclude: ["**/*.spec.luau"],
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap().rootDirs).toEqual([
				"/repo/core",
				"/repo/places/lobby",
			]);
			expect(result.unwrap().exclude).toEqual(["/repo/**/*.spec.luau"]);
		});

		it("should replace a string field set in the child", async () => {
			await write("/repo/source.rogen.json", {
				syncDir: "out",
				template: "one.project.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./source.rogen.json",
				syncDir: "dist",
				template: "two.project.json",
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap()).toMatchObject({
				syncDir: "/repo/dist",
				template: "/repo/two.project.json",
			});
		});

		it("should inherit a field the child leaves out", async () => {
			await write("/repo/source.rogen.json", {
				rootDirs: ["src"],
				exclude: ["**/*.spec.luau"],
				template: "template.project.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./source.rogen.json",
				syncDir: "dist",
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap()).toMatchObject({
				rootDirs: ["/repo/src"],
				exclude: ["/repo/**/*.spec.luau"],
				template: "/repo/template.project.json",
				syncDir: "/repo/dist",
			});
		});

		it("should not inherit outFile", async () => {
			await write("/repo/base.rogen.json", {
				outFile: "shared.project.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap().outFile).toBeUndefined();
		});

		it("should keep the leaf's own outFile", async () => {
			await write("/repo/base.rogen.json", {
				outFile: "shared.project.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				outFile: "build/game.project.json",
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap().outFile).toBe(
				"/repo/build/game.project.json"
			);
		});

		it("should not inherit $schema", async () => {
			await write("/repo/base.rogen.json", {
				$schema: "https://example.com/rogen.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap()).not.toHaveProperty("$schema");
		});

		it("should resolve a parent's relative paths against the parent's directory", async () => {
			await fs.createDirectory("/repo/shared");
			await fs.createDirectory("/repo/places");
			await write("/repo/shared/core.rogen.json", {
				rootDirs: ["src"],
				exclude: ["**/*.spec.luau"],
				template: "template.project.json",
				syncDir: "out",
			});
			await write("/repo/places/lobby.rogen.json", {
				extends: "../shared/core.rogen.json",
			});

			const result = await collapseConfig(
				fs,
				"/repo/places/lobby.rogen.json"
			);

			expect(result.unwrap()).toMatchObject({
				rootDirs: ["/repo/shared/src"],
				exclude: ["/repo/shared/**/*.spec.luau"],
				template: "/repo/shared/template.project.json",
				syncDir: "/repo/shared/out",
			});
		});

		it("should resolve a three-deep chain from the outermost ancestor inwards", async () => {
			await write("/repo/core.rogen.json", {
				rootDirs: ["core"],
				routes: { server: "ServerScriptService", client: "StarterGui" },
				tags: { mock: false },
			});
			await write("/repo/lobby-source.rogen.json", {
				extends: "./core.rogen.json",
				rootDirs: ["core", "places/lobby"],
				routes: { client: "StarterPlayer/StarterPlayerScripts" },
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./lobby-source.rogen.json",
				syncDir: "dist/lobby",
				tags: { mock: true },
			});

			const result = await collapseConfig(fs, "/repo/lobby.rogen.json");

			expect(result.unwrap()).toEqual({
				file: "/repo/lobby.rogen.json",
				chain: [
					"/repo/lobby.rogen.json",
					"/repo/lobby-source.rogen.json",
					"/repo/core.rogen.json",
				],
				rootDirs: ["/repo/core", "/repo/places/lobby"],
				routes: {
					server: "ServerScriptService",
					client: "StarterPlayer/StarterPlayerScripts",
				},
				tags: { mock: true },
				syncDir: "/repo/dist/lobby",
			});
		});

		it("should report a self-referencing config as a cycle", async () => {
			await write(
				"/repo/a.rogen.json",
				`{
	"extends": "./a.rogen.json"
}`
			);

			const result = await collapseConfig(fs, "/repo/a.rogen.json");

			expect(diagnosticsOf(result)).toEqual([
				{
					severity: "error",
					message:
						"extends cycle: /repo/a.rogen.json -> /repo/a.rogen.json.",
					file: "/repo/a.rogen.json",
					line: 2,
					column: 13,
				},
			]);
		});

		it("should name every file in a cycle", async () => {
			await write("/repo/a.rogen.json", { extends: "./b.rogen.json" });
			await write("/repo/b.rogen.json", { extends: "./c.rogen.json" });
			await write("/repo/c.rogen.json", { extends: "./b.rogen.json" });

			const result = await collapseConfig(fs, "/repo/a.rogen.json");

			const [diagnostic] = diagnosticsOf(result);
			expect(diagnostic.file).toBe("/repo/c.rogen.json");
			expect(diagnostic.message).toBe(
				"extends cycle: /repo/b.rogen.json -> /repo/c.rogen.json -> /repo/b.rogen.json."
			);
		});

		it("should report a missing extends target with its path and the referring file", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"extends": "./missing.rogen.json"
}`
			);

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			const [diagnostic] = diagnosticsOf(result);
			expect(diagnostic).toMatchObject({
				severity: "error",
				file: "/repo/default.rogen.json",
				line: 2,
				column: 13,
			});
			expect(diagnostic.message).toContain("/repo/missing.rogen.json");
			expect(diagnostic.message).toContain("could not be read");
		});

		it("should report a missing leaf config", async () => {
			const result = await collapseConfig(fs, "/repo/nope.rogen.json");

			const [diagnostic] = diagnosticsOf(result);
			expect(diagnostic).toMatchObject({
				severity: "error",
				file: "/repo/nope.rogen.json",
				line: 1,
				column: 1,
			});
			expect(diagnostic.message).toContain("could not be read");
		});

		it("should report the diagnostics of an invalid ancestor against that file", async () => {
			await write("/repo/base.rogen.json", { bogus: true });
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(diagnosticsOf(result)).toMatchObject([
				{
					file: "/repo/base.rogen.json",
					message: 'unknown field "bogus".',
				},
			]);
		});

		it("should reject a null extends", async () => {
			await write("/repo/default.rogen.json", { extends: null });

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(diagnosticsOf(result).map((d) => d.message)).toEqual([
				'"extends": expected a string, found null.',
			]);
		});

		it("should read each file in the chain exactly once", async () => {
			const reads: string[] = [];
			class RecordingFileSystemService extends MemoryFileSystemService {
				override async readFile(filePath: string): Promise<string> {
					reads.push(filePath);
					return super.readFile(filePath);
				}
			}
			fs = new RecordingFileSystemService();
			await fs.createDirectory("/repo");
			await write("/repo/core.rogen.json", { rootDirs: ["core"] });
			await write("/repo/default.rogen.json", {
				extends: "./core.rogen.json",
			});

			await collapseConfig(fs, "/repo/default.rogen.json");

			expect(reads.sort()).toEqual([
				"/repo/core.rogen.json",
				"/repo/default.rogen.json",
			]);
		});

		it("should reject null in an ancestor's routes and tags", async () => {
			await write("/repo/base.rogen.json", {
				routes: { server: null },
				tags: { mock: null },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(
				diagnosticsOf(result).map((d) => [d.file, d.message])
			).toEqual([
				[
					"/repo/base.rogen.json",
					'"routes.server": expected a string, found null.',
				],
				[
					"/repo/base.rogen.json",
					'"tags.mock": expected a boolean, found null.',
				],
			]);
		});

		it("should keep a trailing slash on an excluded directory", async () => {
			await write("/repo/default.rogen.json", { exclude: ["dist/"] });

			const result = await collapseConfig(fs, "/repo/default.rogen.json");

			expect(result.unwrap().exclude).toEqual(["/repo/dist/"]);
		});
	});
});
