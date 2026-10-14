import { jest } from "@jest/globals";
import {
	useConfigFixture,
	selection,
	write,
	plain,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

const ROUTED = { server: "ServerScriptService" };

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("resolution", () => {
		const diagnosticsFor = async (
			config: Record<string, unknown> | string,
			file = "/repo/rogen.json"
		) => {
			await write(file, config);
			await start();
			return errors(0).map((d) => [
				d.message,
				d.resource,
				d.position?.line,
				d.position?.column,
			]);
		};

		it("should default the source paths to src when it declares routes", async () => {
			await write("/repo/rogen.json", { routes: ROUTED });

			await start();

			expect(resolved(0)?.sourcePaths).toEqual(["/repo/src"]);
		});

		it("should scan nothing when it declares no routes", async () => {
			await write("/repo/rogen.json", {});

			await start();

			expect(plain(resolved(0))).toMatchObject({
				sourcePaths: [],
				routes: {},
				projectFile: "/repo/default.project.json",
			});
		});

		it("should resolve its paths against the folder of the config", async () => {
			await write("/repo/places/lobby/rogen.json", {
				routes: ROUTED,
				sourcePaths: ["code"],
				syncPath: "out",
			});

			await start({ names: ["places/lobby"] });

			expect(plain(resolved(0))).toMatchObject({
				sourcePaths: ["/repo/places/lobby/code"],
				syncPath: "/repo/places/lobby/out",
				projectFile: "/repo/places/lobby/default.project.json",
			});
		});

		it("should resolve globIgnorePaths against the folder, and keep them for Rojo as written", async () => {
			await write("/repo/rogen.json", {
				globIgnorePaths: ["**/*.spec.luau"],
			});

			await start();

			expect(resolved(0)?.ignored).toEqual(["/repo/**/*.spec.luau"]);
			expect(resolved(0)?.project.globIgnorePaths).toEqual([
				"**/*.spec.luau",
			]);
		});

		describe("project name", () => {
			it("should be the name the config sets", async () => {
				await write("/repo/rogen.json", { name: "Dungeon" });

				await start();

				expect(resolved(0)?.projectName).toBe("Dungeon");
			});

			it("should fall back to the config's directory", async () => {
				await write("/repo/rogen.json", {});

				await start();

				expect(resolved(0)?.projectName).toBe("repo");
			});

			it("should never be empty", async () => {
				await write("/rogen.json", {});

				await start({}, "/");

				expect(resolved(0)?.projectName).toBe("project");
			});

			it("should ignore an empty name", async () => {
				await write("/repo/rogen.json", { name: "" });

				await start();

				expect(resolved(0)?.projectName).toBe("repo");
			});
		});

		describe("project", () => {
			it("should default to a bare DataModel", async () => {
				await write("/repo/rogen.json", {});

				await start();

				expect(resolved(0)?.project.getFile()).toEqual({
					tree: { $className: "DataModel" },
				});
			});

			it("should hold the tree and Rojo's keys, without Rogen's or the schema", async () => {
				await write("/repo/rogen.json", {
					$schema: "https://example.com/rogen.json",
					name: "Dungeon",
					servePort: 34873,
					emitLegacyScripts: false,
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Packages: { $path: "Packages" } },
					},
					routes: ROUTED,
					sourcePaths: ["src"],
					syncPath: "out",
				});

				await start();

				expect(resolved(0)?.project.getFile()).toEqual({
					name: "Dungeon",
					servePort: 34873,
					emitLegacyScripts: false,
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Packages: { $path: "Packages" } },
					},
				});
			});

			it("should report a tree node that is not an object", async () => {
				const problems = await diagnosticsFor(`{
	"tree": { "$className": "DataModel", "Workspace": 1 }
}`);

				expect(problems).toEqual([
					[
						'"tree.Workspace": expected an object, found a number.',
						"/repo/rogen.json",
						2,
						52,
					],
				]);
			});
		});

		describe("validation", () => {
			it("should reject a route key with a separator", async () => {
				const problems = await diagnosticsFor(`{
	"routes": {
		"my-key": "ServerScriptService"
	}
}`);

				expect(problems).toEqual([
					[
						'route key "my-key" is invalid: use letters and digits only, starting with a letter.',
						"/repo/rogen.json",
						3,
						13,
					],
				]);
			});

			it("should accept the fallback route key", async () => {
				expect(
					await diagnosticsFor({
						routes: { "*": "ReplicatedStorage" },
					})
				).toEqual([]);
			});

			it.each([
				["src/out", "is inside"],
				["src", "is inside"],
				[".", "contains"],
			])(
				"should reject the sync path %j against the source path src",
				async (syncPath, relation) => {
					const problems = await diagnosticsFor({
						routes: ROUTED,
						sourcePaths: ["src"],
						syncPath,
					});

					expect(problems).toHaveLength(1);
					expect(problems[0][0]).toContain(
						`${relation} source path "/repo/src"`
					);
				}
			);

			it("should accept a sync path beside the source paths", async () => {
				expect(
					await diagnosticsFor({
						routes: ROUTED,
						sourcePaths: ["src"],
						syncPath: "dist",
					})
				).toEqual([]);
			});

			it("should reject two route keys that differ only in the case of their first letter", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService", "Server": "Workspace" }
}`);

				expect(problems).toEqual([
					[
						'"Server" and "server" differ only in the case of their first letter, so both would match the same names; keep one of them.',
						"/repo/rogen.json",
						2,
						57,
					],
				]);
			});

			it("should accept keys that differ beyond the first letter", async () => {
				expect(
					await diagnosticsFor({
						routes: {
							server: "ServerScriptService",
							SERVER: "Workspace",
						},
					})
				).toEqual([]);
			});

			it("should reject a route target whose service is unsupported", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "Nowhere/Folder" }
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain(
					'"Nowhere" is not a supported service'
				);
				expect(problems[0].slice(1)).toEqual([
					"/repo/rogen.json",
					2,
					24,
				]);
			});

			it("should reject a source path inside another, naming both", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"sourcePaths": ["src", "src/shared"]
}`);

				expect(problems).toEqual([
					[
						'source path "/repo/src/shared" is inside source path "/repo/src"; a file under it would belong to both. Remove one.',
						"/repo/rogen.json",
						3,
						25,
					],
				]);
			});

			it("should reject a source path listed twice, at the repeat", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"sourcePaths": ["src", "./src"]
}`);

				expect(problems).toEqual([
					[
						'source path "/repo/src" is listed twice; a file under it would belong to both. Remove one.',
						"/repo/rogen.json",
						3,
						25,
					],
				]);
			});

			it("should catch the nesting whichever order the source paths come in", async () => {
				const problems = await diagnosticsFor({
					routes: ROUTED,
					sourcePaths: ["src/shared", "src"],
				});

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain(
					'source path "/repo/src/shared" is inside source path "/repo/src"'
				);
			});

			it("should accept source paths that are only siblings or share a prefix", async () => {
				expect(
					await diagnosticsFor({
						routes: ROUTED,
						sourcePaths: ["core", "places/lobby", "core-extra"],
					})
				).toEqual([]);
			});

			it("should report every problem at once", async () => {
				const problems = await diagnosticsFor({
					routes: { "a-b": "Nowhere" },
					syncPath: "src",
					sourcePaths: ["src", "src/x"],
				});

				expect(problems).toHaveLength(4);
			});

			it("should keep the last valid config when a reload turns a rule bad", async () => {
				await write("/repo/rogen.json", {
					routes: ROUTED,
					sourcePaths: ["a"],
				});
				await start();

				await write("/repo/rogen.json", {
					routes: ROUTED,
					sourcePaths: ["a", "a/b"],
				});
				await selection.reload(["/repo/rogen.json"]);

				expect(resolved(0)?.sourcePaths).toEqual(["/repo/a"]);
				expect(errors(0)).toHaveLength(1);
			});
		});

		it("should read neither the working directory nor the clock", async () => {
			await write("/repo/rogen.json", {
				routes: ROUTED,
				sourcePaths: ["a"],
			});
			const cwd = jest.spyOn(process, "cwd");
			const now = jest.spyOn(Date, "now");

			await start();

			expect(cwd).not.toHaveBeenCalled();
			expect(now).not.toHaveBeenCalled();
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});
});
