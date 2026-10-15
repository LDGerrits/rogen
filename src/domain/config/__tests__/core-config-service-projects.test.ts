import {
	errors,
	plain,
	resolved,
	selection,
	start,
	useConfigFixture,
	write,
} from "./config-fixture.js";
import { buildableProjects } from "../config-service.js";

const BASE = {
	name: "Game",
	servePort: 34872,
	tree: {
		$className: "DataModel",
		ReplicatedStorage: { Vendor: { $path: "vendor" } },
	},
	routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
	sourcePaths: ["src", "dev"],
	globIgnorePaths: ["**/*.spec.luau"],
};

describe("CoreConfigService", () => {
	useConfigFixture();

	const projects = async (config: Record<string, unknown>) => {
		await write("/repo/rogen.json", config);
		await start();
		return buildableProjects(selection.entries[0]);
	};

	const projectOf = async (
		changes: Record<string, unknown>,
		base: Record<string, unknown> = BASE
	) => {
		const found = await projects({ ...base, projects: { dist: changes } });
		return plain(found.find(({ stem }) => stem === "dist"));
	};

	describe("projects", () => {
		it("should resolve the description alone when there are none", async () => {
			const found = await projects(BASE);

			expect(found.map(({ stem }) => stem)).toEqual(["default"]);
			expect(found[0].serveProject).toBe("default");
		});

		it("should resolve a project beside the description, written to its own file", async () => {
			const found = await projects({ ...BASE, projects: { dist: {} } });

			expect(found.map(({ stem }) => stem)).toEqual(["default", "dist"]);
			expect(found.map(({ projectFile }) => projectFile)).toEqual([
				"/repo/default.project.json",
				"/repo/dist.project.json",
			]);
			expect(found.every(({ file }) => file === "/repo/rogen.json")).toBe(
				true
			);
		});

		it("should keep the order the projects are declared in", async () => {
			const found = await projects({
				...BASE,
				projects: { release: {}, dist: {} },
			});

			expect(found.map(({ stem }) => stem)).toEqual([
				"default",
				"release",
				"dist",
			]);
		});

		it("should give a project everything the description has when it changes nothing", async () => {
			const found = await projects({ ...BASE, projects: { dist: {} } });

			expect(plain(found[1])).toEqual({
				...plain(found[0]),
				projectFile: "/repo/dist.project.json",
			});
		});

		it("should tell a project's label from the description's", async () => {
			const found = await projects({ ...BASE, projects: { dist: {} } });

			expect(found.map(({ label }) => label)).toEqual([
				"Game",
				"Game (dist)",
			]);
		});

		describe("what a project changes", () => {
			it("should replace a scalar", async () => {
				expect(
					(await projectOf({ servePort: 34873 }))?.project
				).toMatchObject({ servePort: 34873, name: "Game" });
			});

			it("should replace a list instead of adding to it", async () => {
				const dist = await projectOf({ sourcePaths: ["src"] });

				expect(dist?.sourcePaths).toEqual(["/repo/src"]);
			});

			it("should replace globIgnorePaths as a list", async () => {
				const dist = await projectOf({
					globIgnorePaths: ["**/*.test.luau"],
				});

				expect(dist?.ignored).toEqual(["/repo/**/*.test.luau"]);
			});

			it("should merge routes by key", async () => {
				const dist = await projectOf({
					routes: { client: "StarterPlayer/StarterPlayerScripts" },
				});

				expect(dist?.routes).toEqual({
					server: "ServerScriptService",
					"*": "ReplicatedStorage",
					client: "StarterPlayer/StarterPlayerScripts",
				});
			});

			it("should replace the target of a route", async () => {
				const dist = await projectOf({
					routes: { server: "ServerStorage" },
				});

				expect(dist?.routes.server).toBe("ServerStorage");
			});

			it("should merge the tree by node", async () => {
				const dist = await projectOf({
					tree: { ReplicatedStorage: { Extra: { $path: "extra" } } },
				});

				expect(dist?.project.tree).toEqual({
					$className: "DataModel",
					ReplicatedStorage: {
						Vendor: { $path: "vendor" },
						Extra: { $path: "extra" },
					},
				});
			});

			describe("a mount globIgnorePaths ignores", () => {
				const treeOf = async (globIgnorePaths: string[]) =>
					(await projectOf({ globIgnorePaths }))?.project.tree;

				it.each(["vendor/**", "v*/**", "**/vendor/**"])(
					"should be left out of the tree for %s",
					async (glob) => {
						expect(await treeOf([glob])).toEqual({
							$className: "DataModel",
							ReplicatedStorage: {},
						});
					}
				);

				it.each([
					"vendor",
					"vendor/",
					"**/vendor",
					"vendor/*",
					"vendor/*.luau",
					"**/*.luau",
					"vendor/**/*.luau",
				])(
					"should stay in the tree for %s, which Rojo does not read as ignoring the folder",
					async (glob) => {
						expect(await treeOf([glob])).toMatchObject({
							ReplicatedStorage: { Vendor: { $path: "vendor" } },
						});
					}
				);

				it("should be left out of the description too", async () => {
					const [description] = await projects({
						...BASE,
						globIgnorePaths: ["vendor/**"],
					});

					expect(description.project.getFile().tree).toEqual({
						$className: "DataModel",
						ReplicatedStorage: {},
					});
				});

				it("should be left out when the $path is optional", async () => {
					const found = await projectOf({
						tree: {
							ReplicatedStorage: {
								Vendor: { $path: { optional: "vendor" } },
							},
						},
						globIgnorePaths: ["vendor/**"],
					});

					expect(found?.project.tree).toMatchObject({
						ReplicatedStorage: {},
					});
				});

				it("should leave the description's mount in the description", async () => {
					const found = await projects({
						...BASE,
						projects: { dist: { globIgnorePaths: ["vendor/**"] } },
					});

					expect(found[0].project.getFile().tree).toMatchObject({
						ReplicatedStorage: { Vendor: { $path: "vendor" } },
					});
				});
			});

			it("should leave the description alone", async () => {
				const found = await projects({
					...BASE,
					projects: {
						dist: {
							routes: { server: "ServerStorage" },
							name: "Other",
						},
					},
				});

				expect(plain(found[0])).toMatchObject({
					name: "Game",
					routes: {
						server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				});
			});

			it("should change the sync path", async () => {
				const dist = await projectOf({ syncPath: "dist" });

				expect(dist?.syncPath).toBe("/repo/dist");
			});

			it("should inherit the name, and take the folder's when there is none", async () => {
				const named = await projectOf({});
				const nameless = await projectOf(
					{},
					{ ...BASE, name: undefined }
				);

				expect(named?.name).toBe("Game");
				expect(nameless?.name).toBe("repo");
			});

			it("should take a name of its own", async () => {
				expect((await projectOf({ name: "Dist" }))?.name).toBe("Dist");
			});
		});

		describe("serveProject", () => {
			it("should name the project serve serves, for every project", async () => {
				const found = await projects({
					...BASE,
					serveProject: "dist",
					projects: { dist: {} },
				});

				expect(found.map(({ serveProject }) => serveProject)).toEqual([
					"dist",
					"dist",
				]);
			});

			it("should fail when it names no project", async () => {
				await write("/repo/rogen.json", {
					...BASE,
					serveProject: "dist",
				});
				await start();

				expect(errors(0)).toMatchObject([
					{
						code: "config.unknownServeProject",
						message: expect.stringContaining(
							'"serveProject" names "dist"'
						),
						position: { line: 1 },
					},
				]);
			});

			it("should accept default", async () => {
				await write("/repo/rogen.json", {
					...BASE,
					serveProject: "default",
				});
				await start();

				expect(resolved(0)).toBeDefined();
			});
		});

		describe("what is wrong with a project", () => {
			const failure = async (config: Record<string, unknown>) => {
				await write("/repo/rogen.json", { ...BASE, ...config });
				await start();
				return errors(0);
			};

			it("should refuse default as a project name", async () => {
				expect(
					await failure({ projects: { default: {} } })
				).toMatchObject([
					{
						code: "config.reservedProject",
						message: expect.stringContaining(
							"the description itself"
						),
					},
				]);
			});

			it("should refuse a spelling of default in another case, which writes the same file on Windows and macOS", async () => {
				expect(
					await failure({ projects: { Default: {} } })
				).toMatchObject([
					{
						code: "config.reservedProject",
						message: expect.stringContaining("ignore letter case"),
					},
				]);
			});

			it("should refuse two names that differ only in letter case", async () => {
				expect(
					await failure({ projects: { dist: {}, Dist: {} } })
				).toMatchObject([
					{
						code: "config.ambiguousProject",
						message: expect.stringContaining(
							'"Dist" and "dist" differ only in letter case'
						),
					},
				]);
			});

			it.each(["a/b", "a b", "-a", "a.b", ""])(
				"should refuse %j as a project name",
				async (name) => {
					expect(
						await failure({ projects: { [name]: {} } })
					).toMatchObject([{ code: "config.invalidProjectName" }]);
				}
			);

			it.each(["projects", "serveProject"])(
				"should refuse %s inside a project",
				async (key) => {
					expect(
						await failure({ projects: { dist: { [key]: {} } } })
					).toMatchObject([{ code: "config.projectKey" }]);
				}
			);

			it("should warn of a key neither Rojo's nor Rogen's, as the description does", async () => {
				await write("/repo/rogen.json", {
					...BASE,
					projects: { dist: { servePrt: 1 } },
				});
				await start();

				const dist = buildableProjects(selection.entries[0])[1];
				expect(dist.warnings).toMatchObject([
					{
						code: "config.unknownField",
						message: expect.stringContaining(
							'Did you mean "servePort"?'
						),
					},
				]);
			});

			it("should offer no replacement for such a key, since its position is its value's", async () => {
				await write("/repo/rogen.json", {
					...BASE,
					projects: { dist: { servePrt: 1 } },
				});
				await start();

				const dist = buildableProjects(selection.entries[0])[1];
				expect(dist.warnings[0].fixes).toBeUndefined();
			});

			it("should tell a key Rogen read once is gone, inside a project", async () => {
				expect(
					await failure({ projects: { dist: { extends: "x" } } })
				).toMatchObject([{ code: "config.removedField" }]);
			});

			it("should point an error of a project's own value at that value", async () => {
				await write(
					"/repo/rogen.json",
					`{
	"routes": { "server": "ServerScriptService" },
	"projects": {
		"dist": { "routes": { "bad": "Nowhere" } }
	}
}`
				);
				await start();

				expect(errors(0)[0]).toMatchObject({
					position: { line: 4 },
				});
			});

			it("should point an error of an inherited value at the description's", async () => {
				await write(
					"/repo/rogen.json",
					`{
	"routes": { "bad key": "ServerScriptService" },
	"projects": { "dist": {} }
}`
				);
				await start();

				expect(
					errors(0).every((error) => error.position?.line === 2)
				).toBe(true);
			});

			it("should report an error in a project once, though it breaks the whole file", async () => {
				await write("/repo/rogen.json", {
					...BASE,
					projects: { dist: { routes: { bad: "Nowhere" } } },
				});
				await start();

				expect(selection.entries[0].status).toBe("broken");
				expect(errors(0)).toHaveLength(1);
			});

			it.each([
				["a route", { routes: { server: null } }],
				["a node of the tree", { tree: { ReplicatedStorage: null } }],
				["a Rojo key", { servePort: null }],
				["all routes", { routes: null }],
			])("should refuse null for %s in a project", async (_, changes) => {
				expect(
					await failure({ projects: { dist: changes } })
				).toMatchObject([{ code: "config.wrongType" }]);
			});

			it("should refuse null in the description itself", async () => {
				expect(await failure({ servePort: null })).toMatchObject([
					{ code: "config.wrongType" },
				]);
			});

			it("should keep the last valid version, projects included, while the file is broken", async () => {
				await write("/repo/rogen.json", {
					...BASE,
					projects: { dist: {} },
				});
				await start();
				await write("/repo/rogen.json", {
					...BASE,
					projects: { default: {} },
				});
				await selection.reload(["/repo/rogen.json"]);

				expect(selection.entries[0].status).toBe("broken");
				expect(selection.configs.map(({ stem }) => stem)).toEqual([
					"default",
					"dist",
				]);
			});
		});

		describe("in a selection", () => {
			it("should list the projects of every config, the description of each first", async () => {
				await write("/repo/a/rogen.json", { projects: { x: {} } });
				await write("/repo/b/rogen.json", { projects: { y: {} } });
				await start({ names: ["a", "b"] });

				expect(
					selection.configs.map(({ file, stem }) => `${file}#${stem}`)
				).toEqual([
					"/repo/a/rogen.json#default",
					"/repo/a/rogen.json#x",
					"/repo/b/rogen.json#default",
					"/repo/b/rogen.json#y",
				]);
			});

			it("should return every project from requireValid", async () => {
				await write("/repo/rogen.json", { projects: { dist: {} } });
				await start();

				expect(
					selection
						.requireValid()
						.unwrap()
						.map(({ stem }) => stem)
				).toEqual(["default", "dist"]);
			});

			it("should hold the project a *.project.json path names", async () => {
				await write("/repo/rogen.json", { projects: { dist: {} } });

				await start({ names: ["dist.project.json"] });

				expect(selection.named).toEqual(
					new Map([
						["/repo/rogen.json", { names: ["dist"], usual: false }],
					])
				);
			});

			it("should hold the project a bare name stands for", async () => {
				await write("/repo/rogen.json", { projects: { dist: {} } });

				await start({ names: ["dist"] });

				expect(selection.named).toEqual(
					new Map([
						["/repo/rogen.json", { names: ["dist"], usual: false }],
					])
				);
			});

			it("should fail when the config has no project of that name, naming the ones it has", async () => {
				await write("/repo/rogen.json", { projects: { dist: {} } });

				const result = await start({ names: ["release"] });

				expect(result.isErr()).toBe(true);
				expect(String((result as { error: Error }).error.message)).toBe(
					'No project "release" in rogen.json, which has "default" and "dist". Projects are the keys of "projects" in rogen.json: add "release": {} to have Rogen write release.project.json. Or name a folder with a rogen.json, or one of the projects above.'
				);
			});

			it("should say a project file of that name is there but not written by Rogen", async () => {
				await write("/repo/rogen.json", { projects: { dist: {} } });
				await write("/repo/test.project.json", { name: "test" });

				const result = await start({ names: ["test"] });

				expect(
					String((result as { error: Error }).error.message)
				).toContain(
					"test.project.json is there, but a project file Rogen does not write is not a project."
				);
			});

			it("should not complain of a missing project when the config does not load", async () => {
				await write("/repo/rogen.json", "{ nope");

				const result = await start({ names: ["dist"] });

				expect(result.isOk()).toBe(true);
				expect(selection.entries[0].status).toBe("broken");
			});

			it("should say a name is a folder when it is also a project, and use the folder", async () => {
				await write("/repo/rogen.json", { projects: { dist: {} } });
				await write("/repo/dist/rogen.json", {});

				await start({ names: ["dist"] });

				expect(selection.entries.map(({ file }) => file)).toEqual([
					"/repo/dist/rogen.json",
				]);
				expect(selection.named).toEqual(new Map());
				expect(selection.notes).toEqual([
					'"dist" is a folder with a rogen.json and also a project of rogen.json: using the folder. To use the project, name its file, dist.project.json.',
				]);
			});

			it("should say nothing of a folder that is not also a project", async () => {
				await write("/repo/rogen.json", { projects: { dist: {} } });
				await write("/repo/lobby/rogen.json", {});

				await start({ names: ["lobby"] });

				expect(selection.notes).toEqual([]);
			});
		});

		describe("reloading", () => {
			it("should report a change to a project as a change to the config", async () => {
				await write("/repo/rogen.json", {
					...BASE,
					projects: { dist: { servePort: 1 } },
				});
				await start();

				await write("/repo/rogen.json", {
					...BASE,
					projects: { dist: { servePort: 2 } },
				});
				const reloaded = await selection.reload(["/repo/rogen.json"]);

				expect(reloaded.changed).toEqual(["/repo/rogen.json"]);
				expect(
					selection.configs
						.find(({ stem }) => stem === "dist")
						?.project.getFile()
				).toMatchObject({ servePort: 2 });
			});

			it("should keep the resolved projects of a file that reloads equal", async () => {
				await write("/repo/rogen.json", {
					...BASE,
					projects: { dist: {} },
				});
				await start();
				const before = selection.configs;

				const reloaded = await selection.reload(["/repo/rogen.json"]);

				expect(reloaded.changed).toEqual([]);
				expect(selection.configs).toEqual(before);
				expect(selection.configs[1]).toBe(before[1]);
			});
		});
	});
});
