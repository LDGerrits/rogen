import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	useConfigFixture,
	fs,
	selection,
	useFileSystem,
	write,
	plain,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("extends", () => {
		it("should merge maps key by key with the child winning", async () => {
			await write("/repo/base.rogen.json", {
				routes: { server: "ServerScriptService", "*": "ServerStorage" },
				variants: ["mock", "debug"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				routes: {
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				variants: ["fake"],
			});

			await start();

			expect(plain(resolved(0))).toMatchObject({
				routes: {
					server: "ServerScriptService",
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				variants: { mock: false, debug: false, fake: false },
			});
		});

		it("should add a child's variants, conflicts and a mode's variants to its parent's", async () => {
			await write("/repo/base.rogen.json", {
				variants: ["mock", "halloween"],
				conflicts: [["halloween", "christmas"]],
				mode: "dev",
				modes: { dev: { variants: ["mock"] } },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				variants: ["christmas", "debug"],
				conflicts: [["debug", "halloween"]],
				modes: { dev: { variants: ["debug"] } },
			});

			await start();

			expect(resolved(0)).toMatchObject({
				variants: {
					mock: true,
					halloween: false,
					christmas: false,
					debug: true,
				},
				conflicts: [
					["halloween", "christmas"],
					["debug", "halloween"],
				],
			});
		});

		it("should add a child's list entries to its parent's", async () => {
			await write("/repo/base.rogen.json", {
				rootDirs: ["core"],
				exclude: ["**/*.spec.luau"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["places/lobby"],
				exclude: ["**/*.story.luau"],
			});

			await start();

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/core", "/repo/places/lobby"],
				exclude: ["/repo/**/*.spec.luau", "/repo/**/*.story.luau"],
			});
		});

		it("should add list entries across a chain of three", async () => {
			await write("/repo/core.rogen.json", { exclude: ["a"] });
			await write("/repo/middle.rogen.json", {
				extends: "./core.rogen.json",
				exclude: ["b"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./middle.rogen.json",
				exclude: ["c"],
			});

			await start();

			expect(resolved(0)?.exclude).toEqual([
				"/repo/a",
				"/repo/b",
				"/repo/c",
			]);
		});

		it("should keep a repeated entry at its last position", async () => {
			await write("/repo/base.rogen.json", {
				rootDirs: ["core", "shared"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["core", "places/lobby"],
			});

			await start();

			expect(resolved(0)?.rootDirs).toEqual([
				"/repo/shared",
				"/repo/core",
				"/repo/places/lobby",
			]);
		});

		it("should apply the default list only when no config in the chain sets it", async () => {
			await write("/repo/base.rogen.json", { routes: {} });
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["places/lobby"],
			});

			await start({ names: ["default", "lobby"] });

			expect(resolved(0)?.rootDirs).toEqual(["/repo/src"]);
			expect(resolved(1)?.rootDirs).toEqual(["/repo/places/lobby"]);
		});

		it("should point a root dir diagnostic at the file and position that wrote the entry", async () => {
			await write(
				"/repo/base.rogen.json",
				`{
	"rootDirs": ["src/Lib"]
}`
			);
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["src"],
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.nestedRootDir",
					resource: "/repo/base.rogen.json",
					position: { line: 2, column: 15 },
				},
			]);
		});

		it("should inherit a field the child leaves out and replace one it sets", async () => {
			await write("/repo/one.project.json", { tree: {} });
			await write("/repo/source.rogen.json", {
				rootDirs: ["src"],
				template: "one.project.json",
				syncDir: "out",
			});
			await write("/repo/default.rogen.json", {
				extends: "./source.rogen.json",
				syncDir: "dist",
			});

			await start();

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/src"],
				template: { file: "/repo/one.project.json" },
				syncDir: "/repo/dist",
			});
		});

		it("should resolve a parent's relative paths against the parent's directory", async () => {
			await fs.createDirectory("/repo/shared");
			await fs.createDirectory("/repo/places");
			await write("/repo/shared/template.project.json", { tree: {} });
			await write("/repo/shared/core.rogen.json", {
				rootDirs: ["src"],
				exclude: ["**/*.spec.luau"],
				template: "template.project.json",
				syncDir: "out",
			});
			await write("/repo/places/default.rogen.json", {
				extends: "../shared/core.rogen.json",
			});

			await start({ names: ["places/default.rogen.json"] });

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/shared/src"],
				exclude: ["/repo/shared/**/*.spec.luau"],
				template: { file: "/repo/shared/template.project.json" },
				syncDir: "/repo/shared/out",
			});
		});

		it("should never inherit outFile", async () => {
			await write("/repo/base.rogen.json", {
				outFile: "shared.project.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(resolved(0)?.outFile).toBe("/repo/default.project.json");
		});

		it("should keep the leaf's own outFile", async () => {
			await write("/repo/base.rogen.json", {
				outFile: "shared.project.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				outFile: "build/game.project.json",
			});

			await start();

			expect(resolved(0)?.outFile).toBe("/repo/build/game.project.json");
		});

		it("should resolve a three-deep chain from the outermost ancestor inwards", async () => {
			await write("/repo/core.rogen.json", {
				rootDirs: ["core"],
				routes: { server: "ServerScriptService", client: "StarterGui" },
				variants: ["mock"],
			});
			await write("/repo/lobby-source.rogen.json", {
				extends: "./core.rogen.json",
				rootDirs: ["core", "places/lobby"],
				routes: { client: "StarterPlayer/StarterPlayerScripts" },
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./lobby-source.rogen.json",
				syncDir: "dist/lobby",
				variants: ["debug"],
			});

			await start({ names: ["lobby"] });

			expect(selection.entries[0].parents).toEqual([
				"/repo/lobby-source.rogen.json",
				"/repo/core.rogen.json",
			]);
			expect(plain(resolved(0))).toEqual({
				file: "/repo/lobby.rogen.json",
				name: "repo",
				rootDirs: ["/repo/core", "/repo/places/lobby"],
				routes: {
					server: "ServerScriptService",
					client: "StarterPlayer/StarterPlayerScripts",
				},
				variants: { mock: false, debug: false },
				exclude: [],
				syncDir: "/repo/dist/lobby",
				outFile: "/repo/lobby.project.json",
			});
		});

		it("should read each file in the chain exactly once", async () => {
			const reads: string[] = [];
			class RecordingFileSystemService extends MemoryFileSystemService {
				override async readFile(filePath: string): Promise<string> {
					reads.push(filePath);
					return super.readFile(filePath);
				}
			}
			await useFileSystem(new RecordingFileSystemService());
			await write("/repo/core.rogen.json", { rootDirs: ["core"] });
			await write("/repo/default.rogen.json", {
				extends: "./core.rogen.json",
			});

			await start();

			expect(reads.sort()).toEqual([
				"/repo/core.rogen.json",
				"/repo/default.rogen.json",
			]);
		});

		it("should report a self-referencing config as a cycle", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"extends": "./default.rogen.json"
}`
			);

			await start();

			expect(errors(0)).toEqual([
				{
					severity: DiagnosticSeverity.Error,
					code: "config.extendsCycle",
					message:
						"extends cycle: /repo/default.rogen.json -> /repo/default.rogen.json.",
					resource: "/repo/default.rogen.json",
					position: { line: 2, column: 13 },
				},
			]);
		});

		it("should name every file in a cycle", async () => {
			await write("/repo/default.rogen.json", {
				extends: "./b.rogen.json",
			});
			await write("/repo/b.rogen.json", { extends: "./c.rogen.json" });
			await write("/repo/c.rogen.json", { extends: "./b.rogen.json" });

			await start();

			const [diagnostic] = errors(0);
			expect(diagnostic.resource).toBe("/repo/c.rogen.json");
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

			await start();

			const [diagnostic] = errors(0);
			expect(diagnostic).toMatchObject({
				severity: DiagnosticSeverity.Error,
				code: "config.extendsUnreadable",
				resource: "/repo/default.rogen.json",
				position: { line: 2, column: 13 },
			});
			expect(diagnostic.message).toContain("/repo/missing.rogen.json");
		});

		it("should report a config cut off inside a nested object once", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage"`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.invalidSyntax",
					message: "invalid JSONC: expected '}'.",
					position: { line: 2, column: 38 },
				},
			]);
		});

		it("should say a missing extends target does not exist, where it looked, and that paths are relative to the config", async () => {
			await write("/repo/default.rogen.json", {
				extends: "./missing.rogen.json",
			});

			await start();

			expect(errors(0)[0].message).toBe(
				'"extends" target "./missing.rogen.json" does not exist (looked for /repo/missing.rogen.json). Paths are relative to this config.'
			);
		});

		it("should give the reason for an extends target that is a directory", async () => {
			await fs.createDirectory("/repo/dir.rogen.json");
			await write("/repo/default.rogen.json", {
				extends: "./dir.rogen.json",
			});

			await start();

			expect(errors(0)[0].message).toBe(
				'"extends" target "./dir.rogen.json" could not be read: illegal operation on a directory.'
			);
		});

		it("should give the reason for a template that is a directory", async () => {
			await fs.createDirectory("/repo/t.project.json");
			await write("/repo/default.rogen.json", {
				template: "t.project.json",
			});

			await start();

			expect(errors(0)[0].message).toBe(
				"the template could not be read: illegal operation on a directory."
			);
		});

		it("should never print a Node error code in a message about a file it could not read", async () => {
			await fs.createDirectory("/repo/dir.rogen.json");
			await fs.createDirectory("/repo/t.project.json");
			const cases: Record<string, unknown>[] = [
				{ extends: "./missing.rogen.json" },
				{ extends: "./dir.rogen.json" },
				{ template: "missing.project.json" },
				{ template: "t.project.json" },
			];

			for (const config of cases) {
				await write("/repo/default.rogen.json", config);
				await start();
				expect(errors(0)[0].message).not.toMatch(
					/\b(ENOENT|EISDIR|EACCES|ENOTDIR|ELOOP)\b/
				);
			}
		});

		it("should report the diagnostics of an invalid ancestor against that file", async () => {
			await write("/repo/base.rogen.json", { bogus: true });
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					resource: "/repo/base.rogen.json",
					code: "config.unknownField",
				},
			]);
			expect(selection.files).toContain("/repo/base.rogen.json");
		});

		it("should reject null in an ancestor's routes and variants", async () => {
			await write("/repo/base.rogen.json", {
				routes: { server: null },
				variants: [null],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(errors(0).map((d) => [d.resource, d.message])).toEqual([
				[
					"/repo/base.rogen.json",
					'"routes.server": expected a string, found null.',
				],
				[
					"/repo/base.rogen.json",
					'"variants[0]": expected a string, found null.',
				],
			]);
		});

		it("should keep a trailing slash on an excluded directory", async () => {
			await write("/repo/default.rogen.json", { exclude: ["dist/"] });

			await start();

			expect(resolved(0)?.exclude).toEqual(["/repo/dist/"]);
		});
	});
});
