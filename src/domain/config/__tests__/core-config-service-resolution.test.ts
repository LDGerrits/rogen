import path from "path";
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

const onDisk = (file: string): string => path.resolve(file);

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("resolution", () => {
		const diagnosticsFor = async (
			config: Record<string, unknown> | string,
			file = "/repo/default.rogen.json"
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
			await write("/repo/default.rogen.json", {
				routes: ROUTED,
			});

			await start();

			expect(resolved(0)?.sourcePaths).toEqual(["/repo/src"]);
		});

		it("should scan nothing when it declares no routes", async () => {
			await write("/repo/default.rogen.json", {});

			await start();

			expect(plain(resolved(0))).toMatchObject({
				sourcePaths: [],
				routes: {},
				projectFile: "/repo/default.project.json",
			});
		});

		it.each([
			["default.rogen.json", "default.project.json"],
			["default.rogen.jsonc", "default.project.json"],
			["dist.rogen.json", "dist.project.json"],
			["release.rogen.jsonc", "release.project.json"],
		])(
			"should write the project file of %s as %s beside it",
			async (file, written) => {
				await write(`/repo/${file}`, {
					name: "Game",
					routes: ROUTED,
				});

				await start({ names: [file] });

				expect(resolved(0)?.projectFile).toEqual(`/repo/${written}`);
				expect(resolved(0)?.isAdopted).toBe(false);
			}
		);

		it("should select only the file named when others sit beside it", async () => {
			await write("/repo/default.rogen.json", {
				routes: ROUTED,
			});
			await write("/repo/dist.rogen.json", { name: "Game" });
			await write("/repo/broken.rogen.json", { modes: {} });

			await start({ names: ["dist"] });

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/dist.rogen.json",
			]);
			expect(selection.requireValid().isOk()).toBe(true);
		});

		it("should not read a plain project file beside a config of another name as written by it", async () => {
			await write("/repo/default.rogen.json", {
				routes: ROUTED,
			});
			await write("/repo/nested.project.json", { name: "Nested" });

			await start({ names: ["nested.project.json"] });

			expect(resolved(0)?.isAdopted).toBe(true);
			expect(resolved(0)?.projectFile).toEqual(
				"/repo/nested.project.json"
			);
		});

		it("should refuse a config other than default that has no name, which Rojo can't read once written", async () => {
			await write("/repo/dist.rogen.json", { routes: ROUTED });
			await start({ names: ["dist"] });

			expect(errors(0).map((d) => d.code)).toEqual([
				"config.unnamedProjectFile",
			]);
		});

		it("should not need a name in the default", async () => {
			await write("/repo/default.rogen.json", {
				routes: ROUTED,
			});
			await start();

			expect(errors(0)).toEqual([]);
		});

		it("should resolve its paths against the folder of the config", async () => {
			await write("/repo/places/lobby/default.rogen.json", {
				sourcePaths: ["code"],
				routes: ROUTED,
				compiledPath: "out",
			});

			await start({ names: ["places/lobby"] });

			expect(plain(resolved(0))).toMatchObject({
				sourcePaths: ["/repo/places/lobby/code"],
				compiledPath: "/repo/places/lobby/out",
				projectFile: "/repo/places/lobby/default.project.json",
			});
		});

		it("should resolve globIgnorePaths against the folder, and keep them for Rojo as written", async () => {
			await write("/repo/default.rogen.json", {
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
				await write("/repo/default.rogen.json", { name: "Dungeon" });

				await start();

				expect(resolved(0)?.projectName).toBe("Dungeon");
			});

			it("should fall back to the config's directory", async () => {
				await write("/repo/default.rogen.json", {});

				await start();

				expect(resolved(0)?.projectName).toBe("repo");
			});

			it("should never be empty", async () => {
				await write("/default.rogen.json", {});

				await start({}, "/");

				expect(resolved(0)?.projectName).toBe("project");
			});

			it("should ignore an empty name", async () => {
				await write("/repo/default.rogen.json", { name: "" });

				await start();

				expect(resolved(0)?.projectName).toBe("repo");
			});
		});

		describe("project", () => {
			it("should default to a bare DataModel", async () => {
				await write("/repo/default.rogen.json", {});

				await start();

				expect(resolved(0)?.project.getFile()).toEqual({
					tree: { $className: "DataModel" },
				});
			});

			it("should hold the tree and Rojo's keys, without Rogen's or a $schema", async () => {
				await write("/repo/default.rogen.json", {
					$schema: "https://example.com/rogen.json",
					name: "Dungeon",
					servePort: 34873,
					emitLegacyScripts: false,
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Packages: { $path: "Packages" } },
					},
					sourcePaths: ["src"],
					routes: ROUTED,
					compiledPath: "out",
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
						"/repo/default.rogen.json",
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
						'route key "my-key" is invalid: a name uses letters and digits only, starting with a letter, and a file-name pattern is a glob on the name, such as "*.tsx" or "*[Ss]ervice".',
						"/repo/default.rogen.json",
						3,
						13,
					],
				]);
			});

			it("should accept a file-name pattern as a route key", async () => {
				expect(
					await diagnosticsFor({
						routes: {
							"*.tsx": "StarterPlayer/StarterPlayerScripts",
							"*Controller.*":
								"StarterPlayer/StarterPlayerScripts",
						},
					})
				).toEqual([]);
			});

			it.each([
				[
					"src/*.tsx",
					'a pattern matches a file\'s name, never its path, so it has no "/"; ',
				],
				["**.tsx", 'a pattern matches one name, so no "**"; '],
				["*[Ss", 'a "[" needs its "]"; '],
				["*{Ui,Hud", 'a "{" needs its "}", with no "{" inside; '],
				["*{a,{b,c}}", 'a "{" needs its "}", with no "{" inside; '],
				[
					"*@client",
					'a key is the name an "@" spells, so it has no "@" itself; ',
				],
				["Shop-Thing", ""],
			])(
				"should reject %j, saying what is wrong with it before the rule",
				async (key, problem) => {
					const problems = await diagnosticsFor({
						routes: { [key]: "ServerScriptService" },
					});

					expect(problems.map(([message]) => message)).toEqual([
						`route key "${key}" is invalid: ${problem}a name uses letters and digits only, starting with a letter, and a file-name pattern is a glob on the name, such as "*.tsx" or "*[Ss]ervice".`,
					]);
				}
			);

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
				"should reject the compiled path %j against the source path src",
				async (compiledPath, relation) => {
					const problems = await diagnosticsFor({
						sourcePaths: ["src"],
						routes: ROUTED,
						compiledPath,
					});

					expect(problems).toHaveLength(1);
					expect(problems[0][0]).toContain(
						`${relation} source path "${onDisk("/repo/src")}"`
					);
				}
			);

			it("should accept a compiled path beside the source paths", async () => {
				expect(
					await diagnosticsFor({
						sourcePaths: ["src"],
						routes: ROUTED,
						compiledPath: "dist",
					})
				).toEqual([]);
			});

			it("should reject two route keys that differ only in letter case", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService", "SERVER": "Workspace" }
}`);

				expect(problems).toEqual([
					[
						'"SERVER" and "server" differ only in letter case, so a name spelled one way would read as a misspelling of the other; keep one of them.',
						"/repo/default.rogen.json",
						2,
						57,
					],
				]);
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
					"/repo/default.rogen.json",
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
						`source path "${onDisk("/repo/src/shared")}" is inside source path "${onDisk("/repo/src")}"; a file under it would belong to both. Remove one.`,
						"/repo/default.rogen.json",
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
						"/repo/default.rogen.json",
						3,
						25,
					],
				]);
			});

			it("should reject a route written twice, at the copy JSON drops", async () => {
				const problems = await diagnosticsFor(`{
	"routes": {
		"Server": "ServerScriptService",
		"Server": "ReplicatedStorage"
	}
}`);

				expect(problems).toEqual([
					[
						'route "Server" is written twice, and JSON keeps only the last, so this one is lost. Remove one.',
						"/repo/default.rogen.json",
						3,
						3,
					],
				]);
			});

			it("should reject a Rogen key written twice", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "Server": "ServerScriptService" },
	"routes": { "Client": "ReplicatedFirst" }
}`);

				expect(problems).toEqual([
					[
						'"routes" is written twice, and JSON keeps only the last, so this one is lost. Remove one.',
						"/repo/default.rogen.json",
						2,
						2,
					],
				]);
			});

			it("should leave a Rojo key written twice to Rojo, which keeps the last", async () => {
				const problems = await diagnosticsFor(`{
	"name": "first",
	"name": "game",
	"routes": { "Server": "ServerScriptService" }
}`);

				expect(problems).toEqual([]);
			});

			it("should catch the nesting whichever order the source paths come in", async () => {
				const problems = await diagnosticsFor({
					sourcePaths: ["src/shared", "src"],
					routes: ROUTED,
				});

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain(
					`source path "${onDisk("/repo/src/shared")}" is inside source path "${onDisk("/repo/src")}"`
				);
			});

			it("should accept source paths that are only siblings or share a prefix", async () => {
				expect(
					await diagnosticsFor({
						sourcePaths: ["core", "places/lobby", "core-extra"],
						routes: ROUTED,
					})
				).toEqual([]);
			});

			it("should report every problem at once", async () => {
				const problems = await diagnosticsFor({
					sourcePaths: ["src", "src/x"],
					routes: { "a-b": "Nowhere" },
					compiledPath: "src",
				});

				expect(problems).toHaveLength(4);
			});

			it("should keep the last valid config when a reload turns a rule bad", async () => {
				await write("/repo/default.rogen.json", {
					sourcePaths: ["a"],
					routes: ROUTED,
				});
				await start();

				await write("/repo/default.rogen.json", {
					sourcePaths: ["a", "a/b"],
					routes: ROUTED,
				});
				await selection.reload([onDisk("/repo/default.rogen.json")]);

				expect(resolved(0)?.sourcePaths).toEqual(["/repo/a"]);
				expect(errors(0)).toHaveLength(1);
			});
		});

		it("should read neither the working directory nor the clock", async () => {
			await write("/repo/default.rogen.json", {
				sourcePaths: ["a"],
				routes: ROUTED,
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
