import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { DerivedRoutes } from "../derived-routes.js";
import { ProjectChoices } from "../project-setup.js";
import { RouteId, StartingRoutes } from "../starting-routes.js";
import { WorkspaceSpec } from "./init-fixtures.js";
import {
	LUAU_ROUTES,
	luau,
	withPackages,
	mounts,
	defaultProjectChoices,
	lifted,
	planProject,
	plan,
	treeOf,
	configOf,
} from "./project-setup-fixtures.js";

describe("TreePlan", () => {
	describe("tree", () => {
		it("should write a DataModel that mounts the packages when mounts were detected", async () => {
			const config = configOf(await plan({ ...luau, ...withPackages }));

			expect(config.tree).toEqual({ $className: "DataModel", ...mounts });
			expect(config.name).toBeUndefined();
		});

		it("should write a bare DataModel when nothing was mounted", async () => {
			expect(configOf(await plan(luau)).tree).toEqual({
				$className: "DataModel",
			});
		});

		const lift = async (
			content: string | object,
			overrides: Partial<ProjectChoices> = {}
		) =>
			planProject({
				choices: {
					...(await defaultProjectChoices(luau)),
					tree: lifted(content),
					...overrides,
				},
				existingFiles: new Set(["default.project.json"]),
			}).unwrap();

		it("should lift the name, tree and other Rojo keys of a hand-written project file", async () => {
			const files = await lift({
				$schema: "https://example.com/project.json",
				name: "mine",
				tree: { $className: "DataModel", Workspace: { Map: {} } },
				servePort: 34872,
				globIgnorePaths: ["**/*.spec.luau"],
			});

			expect(configOf(files)).toEqual({
				name: "mine",
				tree: { $className: "DataModel", Workspace: { Map: {} } },
				servePort: 34872,
				globIgnorePaths: ["**/*.spec.luau"],
				sourcePaths: ["src"],
				routes: LUAU_ROUTES,
			});
			expect(files.notes).toEqual([
				"Lifting default.project.json into default.rogen.json, since Rogen replaces default.project.json on every write.",
			]);
			expect(files.nextSteps.edits).not.toContainEqual(
				expect.stringContaining("Remove the nodes")
			);
		});

		it("should leave out of a lifted tree the nodes that point into the source paths", async () => {
			const files = await lift({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						Shared: { $path: "src/shared" },
						Packages: { $path: "Packages" },
					},
					ServerScriptService: {
						$className: "ServerScriptService",
						Server: { $path: { optional: "./src/server" } },
					},
					StarterPlayer: {
						StarterPlayerScripts: {
							Client: { $path: "src/client" },
						},
					},
					Workspace: {
						Map: {
							$path: "src",
							$properties: { Locked: true },
						},
					},
				},
			});

			expect(configOf(files).tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: { Packages: { $path: "Packages" } },
				ServerScriptService: {
					$className: "ServerScriptService",
				},
				StarterPlayer: { StarterPlayerScripts: {} },
				Workspace: {
					Map: {
						$className: "Folder",
						$properties: { Locked: true },
					},
				},
			});
			expect(files.notes).toEqual([
				"Lifting default.project.json into default.rogen.json, since Rogen replaces default.project.json on every write.",
				"Left out ReplicatedStorage/Shared, ServerScriptService/Server, StarterPlayer/StarterPlayerScripts/Client and Workspace/Map, since they point into src and Rogen generates that code now.",
				"Kept what Workspace/Map set in the tree, on the node the route lands on.",
			]);
			expect(files.nextSteps.edits).not.toContainEqual(
				expect.stringContaining("Remove the nodes")
			);
		});

		describe("routes derived from the nodes it leaves out", () => {
			const tree = {
				$className: "DataModel",
				ReplicatedStorage: { Shared: { $path: "src/shared" } },
				ServerScriptService: {
					Server: { $path: "src/server" },
					Admin: { $path: "src/server/Admin" },
				},
				StarterPlayer: {
					StarterPlayerScripts: { Client: { $path: "src/client" } },
				},
			};

			const planDerived = async (
				content: object,
				holdingInit: readonly string[] = [],
				ticked: (ids: RouteId[]) => RouteId[] = (ids) => ids
			) => {
				const choices = await defaultProjectChoices(luau);
				const whole = lifted({ name: "my-game", tree: content });
				const project =
					whole.kind === "lift"
						? {
								...whole,
								project: whole.project.withInitIn(holdingInit),
							}
						: whole;
				const derived =
					project.kind === "lift"
						? DerivedRoutes.of(
								"default.project.json",
								project.project,
								choices.sourcePaths
							)
						: undefined;
				const starting = new StartingRoutes(
					workspaceOf(luau).languageFor("luau"),
					derived
				);
				return planProject({
					choices: {
						...choices,
						tree: project,
						routes: ticked(starting.tickedByDefault),
						fallback: true,
					},
					existingFiles: new Set(["default.project.json"]),
				}).unwrap();
			};

			it("should write routes that put each folder where the project file had it", async () => {
				const files = await planDerived(tree);

				expect(configOf(files).routes).toEqual({
					Server: "ServerScriptService/Server",
					Shared: "ReplicatedStorage/Shared",
					Client: "StarterPlayer/StarterPlayerScripts/Client",
					"*": "ReplicatedStorage/Shared",
				});
			});

			it("should keep a mount below a folder in the tree, and say why no route makes it", async () => {
				const files = await planDerived(tree);

				expect(configOf(files).tree).toMatchObject({
					ServerScriptService: {
						Admin: { $path: "src/server/Admin" },
					},
				});
				expect(files.notes).toContain(
					"Kept ServerScriptService/Admin in the tree as a $path mount, since no route can make it: only a folder directly in a source path becomes a route."
				);
			});

			it("should name the cause for a folder whose name is no route name", async () => {
				const files = await planDerived({
					ReplicatedStorage: { MyLib: { $path: "src/my-lib" } },
				});

				expect(configOf(files).tree).toMatchObject({
					ReplicatedStorage: { MyLib: { $path: "src/my-lib" } },
				});
				expect(files.notes).toContain(
					"Kept ReplicatedStorage/MyLib in the tree as a $path mount, since no route can make it: my-lib is not a valid route name."
				);
			});

			it("should keep a folder mounted twice in the tree at both nodes", async () => {
				const files = await planDerived({
					ReplicatedStorage: {
						One: { $path: "src/Lib" },
						Two: { $path: "src/Lib" },
					},
				});

				expect(configOf(files).tree).toMatchObject({
					ReplicatedStorage: {
						One: { $path: "src/Lib" },
						Two: { $path: "src/Lib" },
					},
				});
				expect(Object.keys(configOf(files).routes!)).not.toContain(
					"Lib"
				);
			});

			it("should keep a mounted file in the tree", async () => {
				const files = await planDerived({
					ServerScriptService: {
						Main: { $path: "src/deep/Server/Main.server.luau" },
					},
				});

				expect(configOf(files).tree).toMatchObject({
					ServerScriptService: {
						Main: { $path: "src/deep/Server/Main.server.luau" },
					},
				});
			});

			it("should keep a mount in the tree whose folder holds an init file, and say why", async () => {
				const files = await planDerived(
					{
						$className: "DataModel",
						ServerScriptService: {
							Server: { $path: "src/server" },
						},
						ReplicatedStorage: { Shared: { $path: "src/shared" } },
					},
					["src/server"]
				);

				expect(configOf(files).tree).toEqual({
					$className: "DataModel",
					ServerScriptService: { Server: { $path: "src/server" } },
					ReplicatedStorage: {},
				});
				expect(Object.keys(configOf(files).routes!)).not.toContain(
					"mount:server"
				);
				expect(files.notes).toContain(
					"Kept ServerScriptService/Server in the tree as a $path mount, since its folder holds an init file, which Rojo reads as the instance of the folder itself and a route can't."
				);
				expect(files.notes.join("\n")).not.toContain("Couldn't route");
			});

			it("should keep what a mount that becomes a route carried, on the node the route lands on", async () => {
				const settings = {
					$className: "Model",
					$properties: { Archivable: false },
					$attributes: { Tag: "x" },
					$ignoreUnknownInstances: false,
					$id: "shared",
					Extra: { $className: "Folder" },
				};
				const files = await planDerived({
					$className: "DataModel",
					ReplicatedStorage: {
						Shared: { $path: "src/shared", ...settings },
					},
				});

				expect(configOf(files).tree).toEqual({
					$className: "DataModel",
					ReplicatedStorage: { Shared: settings },
				});
				expect(files.notes).toContain(
					"Kept what ReplicatedStorage/Shared set in the tree, on the node the route lands on."
				);
				expect(files.warnings).toEqual([]);
			});

			it("should keep a mount it can't route as a $path mount when it carried settings", async () => {
				const files = await planDerived({
					$className: "DataModel",
					ServerScriptService: {
						Admin: {
							$path: "src/server/Admin",
							$properties: { Archivable: false },
						},
					},
				});

				expect(configOf(files).tree).toEqual({
					$className: "DataModel",
					ServerScriptService: {
						Admin: {
							$path: "src/server/Admin",
							$properties: { Archivable: false },
						},
					},
				});
				expect(files.notes).toContain(
					"Kept ServerScriptService/Admin in the tree as a $path mount, since a route can't carry its settings."
				);
				expect(files.notes.join("\n")).not.toContain("Couldn't route");
			});

			it("should leave the settings out with the mount when its route is not kept", async () => {
				const files = await planDerived(
					{
						$className: "DataModel",
						ServerScriptService: {
							Server: {
								$path: "src/server",
								$properties: { Archivable: false },
							},
						},
					},
					[],
					(ids) => ids.filter((id) => id !== "mount:server")
				);

				expect(JSON.stringify(configOf(files).tree)).not.toContain(
					"Archivable"
				);
				expect(files.notes.join("\n")).not.toContain("Kept what");
			});

			it("should warn with a code about settings no route can land on", async () => {
				const files = await planDerived({
					$className: "DataModel",
					Stray: {
						Map: {
							$path: "src",
							$properties: { Archivable: false },
						},
					},
				});

				expect(files.warnings).toMatchObject([
					{
						code: "init.settingsDropped",
						message: expect.stringContaining(
							"Stray/Map set $properties"
						),
					},
				]);
				expect(JSON.stringify(configOf(files).tree)).not.toContain(
					"Archivable"
				);
			});

			it("should warn with a code when routes take folders out of a node that mounted the whole source path", async () => {
				const files = await planDerived({
					$className: "DataModel",
					ReplicatedStorage: { Common: { $path: "src" } },
					ServerScriptService: { Server: { $path: "src/server" } },
				});

				expect(files.warnings).toMatchObject([
					{
						code: "init.mountNarrowed",
						message:
							"ReplicatedStorage/Common mounted all of src, so Rojo also put src/server inside it. Rogen routes that folder only to ServerScriptService/Server, so a require that reaches it through ReplicatedStorage/Common breaks. Check with 'rogen where src/server'.",
					},
				]);
			});

			it("should lift a root that is no DataModel as it is, with no routes or source paths", async () => {
				const files = await planDerived({ $path: "src" });

				expect(configOf(files)).toEqual({
					name: "my-game",
					tree: { $path: "src" },
				});
				expect(files.notes).toContain(
					"The root of default.project.json is not a DataModel, as in a model or a plugin, so default.rogen.json keeps the tree as Rojo reads it and adds no routes."
				);
				expect(files.nextSteps.edits).not.toContainEqual(
					expect.stringContaining("Add your own routes")
				);
				expect(files.liftedFrom).toBe("default.project.json");
			});

			it("should say nothing about mounts it did route", async () => {
				const files = await planDerived({
					ServerScriptService: { Server: { $path: "src/server" } },
				});

				expect(files.notes.join("\n")).not.toContain("Couldn't route");
			});
		});

		it("should leave out of a lifted tree the nodes that point into the compiled path", async () => {
			const files = planProject({
				choices: {
					...(await defaultProjectChoices({
						...luau,
						language: "roblox-ts",
					})),
					tree: lifted({
						name: "my-game",
						tree: {
							$className: "DataModel",
							ServerScriptService: {
								TS: { $path: "out/server" },
							},
						},
					}),
					mounts: [],
				},
				existingFiles: new Set(["default.project.json"]),
			}).unwrap();

			expect(configOf(files).tree).toEqual({
				$className: "DataModel",
				ServerScriptService: {},
			});
			expect(files.notes[1]).toBe(
				"Left out ServerScriptService/TS, since it points into src or out and Rogen generates that code now."
			);
		});

		it("should write routes for the nodes it leaves out that point into the compiled path", async () => {
			const tsChoices = await defaultProjectChoices({
				...luau,
				language: "roblox-ts",
			});
			const project = lifted({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ServerScriptService: { TS: { $path: "out/server" } },
				},
			});
			const derived =
				project.kind === "lift"
					? DerivedRoutes.of(
							"default.project.json",
							project.project,
							[...tsChoices.sourcePaths, "out"]
						)
					: undefined;
			const files = planProject({
				choices: {
					...tsChoices,
					tree: project,
					mounts: [],
					routes: new StartingRoutes(
						workspaceOf(luau).languageFor("roblox-ts"),
						derived
					).tickedByDefault,
				},
				existingFiles: new Set(["default.project.json"]),
			}).unwrap();

			expect(configOf(files).routes).toMatchObject({
				server: "ServerScriptService/TS",
			});
		});

		it("should keep a $path that isn't a path", async () => {
			const files = await lift({
				name: "my-game",
				tree: { Odd: { $path: 5 }, Empty: { $path: {} } },
			});

			expect(configOf(files).tree).toEqual({
				Odd: { $path: 5 },
				Empty: { $path: {} },
			});
		});

		it("should lift a tree as it is when a source path is the whole folder, and say what to remove", async () => {
			const tree = { Shared: { $path: "shared" } };
			const files = await lift(
				{ name: "my-game", tree },
				{ sourcePaths: ["."] }
			);

			expect(configOf(files).tree).toEqual(tree);
			expect(files.nextSteps.edits[0]).toBe(
				"Remove the nodes in the tree of default.rogen.json that point into .; Rogen generates those now."
			);
		});

		it("should lift a file that has no tree as a bare DataModel", async () => {
			const files = await lift({ name: "my-game" });

			expect(configOf(files).tree).toEqual({ $className: "DataModel" });
		});

		const liftWithMounts = async (
			content: object,
			mountList: ProjectChoices["mounts"]
		) => lift(content, { mounts: mountList });

		it("should add the chosen package mounts a lifted tree lacks", async () => {
			const files = await liftWithMounts(
				{
					name: "my-game",
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Assets: { $path: "assets" } },
					},
				},
				[
					{
						path: "Packages",
						optional: false,
						landing: "ReplicatedStorage/Packages",
					},
					{
						path: "ServerPackages",
						optional: true,
						landing: "ServerScriptService/ServerPackages",
					},
				]
			);

			expect(configOf(files).tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Assets: { $path: "assets" },
					Packages: { $path: "Packages" },
				},
				ServerScriptService: {
					ServerPackages: { $path: { optional: "ServerPackages" } },
				},
			});
			expect(files.notes[1]).toBe(
				"Added Packages at ReplicatedStorage/Packages and ServerPackages at ServerScriptService/ServerPackages to default.rogen.json."
			);
		});

		it("should name every mount it adds under one node", async () => {
			const files = await liftWithMounts({ name: "my-game", tree: {} }, [
				{
					path: "include",
					optional: false,
					landing: "ReplicatedStorage/rbxts_include",
				},
				{
					path: "node_modules/@rbxts",
					optional: false,
					landing:
						"ReplicatedStorage/rbxts_include/node_modules/@rbxts",
				},
			]);

			expect(files.notes[1]).toBe(
				"Added include at ReplicatedStorage/rbxts_include and node_modules/@rbxts at ReplicatedStorage/rbxts_include/node_modules/@rbxts to default.rogen.json."
			);
		});

		it("should keep a lifted tree as it is when it already mounts the packages", async () => {
			const tree = {
				$className: "DataModel",
				ReplicatedStorage: { Deps: { $path: "./Packages" } },
				ServerScriptService: {
					Server: { $path: "ServerPackages" },
				},
			};
			const files = await liftWithMounts({ name: "my-game", tree }, [
				{
					path: "Packages",
					optional: false,
					landing: "ReplicatedStorage/Packages",
				},
				{
					path: "ServerPackages",
					optional: false,
					landing: "ServerScriptService/ServerPackages",
				},
			]);

			expect(configOf(files).tree).toEqual(tree);
			expect(files.notes).toHaveLength(1);
		});

		it("should not mount a folder inside one the lifted tree already mounts", async () => {
			const tree = {
				$className: "DataModel",
				ReplicatedStorage: {
					rbxts_include: {
						$path: "include",
						node_modules: { $path: "node_modules" },
					},
				},
			};
			const files = await liftWithMounts({ name: "my-game", tree }, [
				{
					path: "include",
					optional: false,
					landing: "ReplicatedStorage/rbxts_include",
				},
				{
					path: "node_modules/@rbxts",
					optional: false,
					landing:
						"ReplicatedStorage/rbxts_include/node_modules/@rbxts",
				},
			]);

			expect(configOf(files).tree).toEqual(tree);
		});

		it("should say which mounts it left out because the lifted tree has a node in their place", async () => {
			const tree = {
				$className: "DataModel",
				ReplicatedStorage: { Packages: { $path: "vendor" } },
			};
			const files = await liftWithMounts({ name: "my-game", tree }, [
				{
					path: "Packages",
					optional: false,
					landing: "ReplicatedStorage/Packages",
				},
			]);

			expect(configOf(files).tree).toEqual(tree);
			expect(files.notes[1]).toBe(
				"Didn't add Packages at ReplicatedStorage/Packages to default.rogen.json, since it already has a node there."
			);
		});
	});

	describe("package mounts", () => {
		const rbxts: WorkspaceSpec = { language: "roblox-ts" };

		it("should mount include and @rbxts for roblox-ts, and the scopes it found", async () => {
			expect(
				await treeOf({
					...rbxts,
					robloxTs: {
						rbxtsScopes: ["@rbxts", "@flamework"],
						includeInstalled: true,
					},
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					rbxts_include: {
						$path: "include",
						node_modules: {
							$className: "Folder",
							"@rbxts": { $path: "node_modules/@rbxts" },
							"@flamework": { $path: "node_modules/@flamework" },
						},
					},
				},
			});
		});

		it("should mount include and @rbxts as optional for roblox-ts when missing", async () => {
			expect(await (await treeOf(rbxts)).ReplicatedStorage).toEqual({
				rbxts_include: {
					$path: { optional: "include" },
					node_modules: {
						$className: "Folder",
						"@rbxts": {
							$path: { optional: "node_modules/@rbxts" },
						},
					},
				},
			});
		});

		it("should not mount a scope that is not installed by default", async () => {
			const scopes = await (
				await treeOf({
					...rbxts,
					robloxTs: {
						rbxtsScopes: ["@rbxts"],
						includeInstalled: true,
					},
				})
			).ReplicatedStorage.rbxts_include.node_modules;

			expect(Object.keys(scopes)).toEqual(["$className", "@rbxts"]);
		});

		it("should never mount include or a scope for luau", async () => {
			expect(
				await treeOf({
					robloxTs: {
						includeInstalled: true,
						rbxtsScopes: ["@rbxts"],
					},
				})
			).toEqual({ $className: "DataModel" });
		});

		it("should mount wally packages that exist", async () => {
			expect(
				await treeOf({
					packageManager: "wally",
					packageDirs: new Set(["Packages", "ServerPackages"]),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: { Packages: { $path: "Packages" } },
				ServerScriptService: {
					ServerPackages: { $path: "ServerPackages" },
				},
			});
		});

		it("should mount the wally directories that are missing as optional", async () => {
			expect(await treeOf(withPackages)).toEqual({
				$className: "DataModel",
				...mounts,
			});
		});

		it("should mount wally packages as optional when only wally.toml exists", async () => {
			expect(await treeOf({ packageManager: "wally" })).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Packages: { $path: { optional: "Packages" } },
				},
				ServerScriptService: {
					ServerPackages: { $path: { optional: "ServerPackages" } },
				},
			});
		});

		it("should mount pesde packages that exist", async () => {
			expect(
				await treeOf({
					packageManager: "pesde",
					packageDirs: new Set([
						"roblox_packages",
						"roblox_server_packages",
					]),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: { Packages: { $path: "roblox_packages" } },
				ServerScriptService: {
					ServerPackages: { $path: "roblox_server_packages" },
				},
			});
		});

		it("should only mount the directories of the detected manager", async () => {
			expect(
				await treeOf({
					packageManager: "pesde",
					packageDirs: new Set(["Packages", "ServerPackages"]),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Packages: { $path: { optional: "roblox_packages" } },
				},
				ServerScriptService: {
					ServerPackages: {
						$path: { optional: "roblox_server_packages" },
					},
				},
			});
		});

		it("should assume wally for luau without a manager", async () => {
			expect(
				await treeOf({
					packageDirs: new Set(["Packages", "roblox_packages"]),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: mounts.ReplicatedStorage,
			});
		});

		it("should not mount package directories for roblox-ts without a manager", async () => {
			expect(
				await (
					await treeOf({
						language: "roblox-ts",
						robloxTs: {
							rbxtsScopes: ["@rbxts"],
							includeInstalled: true,
						},
						packageDirs: new Set(["Packages"]),
					})
				).ReplicatedStorage.Packages
			).toBeUndefined();
		});

		it("should combine mounts from several sources under one service", async () => {
			const tree = await treeOf({
				...withPackages,
				language: "roblox-ts",
				robloxTs: { rbxtsScopes: ["@rbxts"] },
			});

			expect(Object.keys(tree)).toEqual([
				"$className",
				"ReplicatedStorage",
				"ServerScriptService",
			]);
			expect(tree.ReplicatedStorage).toMatchObject({
				rbxts_include: expect.anything(),
				Packages: expect.anything(),
			});
		});
	});
});
