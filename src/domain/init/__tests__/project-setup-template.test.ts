import { RojoTree } from "../../rojo/rojo-project.js";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { DerivedRoutes } from "../derived-routes.js";
import { PlaceFolder } from "../place-folder.js";
import { ProjectChoices } from "../project-setup.js";
import { StartingRoutes } from "../starting-routes.js";
import { WorkspaceSpec, directory } from "./init-fixtures.js";
import { TemplateChoice } from "../template-plan.js";
import {
	luau,
	withPackages,
	mounts,
	defaultProjectChoices,
	planProject,
	plan,
	treeOf,
	configOf,
} from "./project-setup-fixtures.js";

describe("ProjectSetup plan", () => {
	describe("template", () => {
		it("should write template.project.json when mounts were detected", async () => {
			const files = await plan({ ...luau, ...withPackages });

			expect(files.template?.fileName).toBe("template.project.json");
			expect(JSON.parse(files.template!.content)).toEqual({
				name: "my-game",
				tree: { $className: "DataModel", ...mounts },
			} satisfies RojoTree);
			expect(configOf(files, "default.rogen.json").template).toBe(
				"template.project.json"
			);
		});

		it("should not write a template when nothing was mounted", async () => {
			const files = await plan(luau);

			expect(files.template).toBeUndefined();
		});

		it("should reference an existing template without rewriting it", async () => {
			const files = await plan({ ...luau, ...withPackages }, "lobby", [
				"template.project.json",
			]);

			expect(files.template).toBeUndefined();
			expect(configOf(files, "lobby.rogen.json").template).toBe(
				"template.project.json"
			);
			expect(files.notes).toEqual(["Using template.project.json."]);
		});

		it("should warn that a hand-written output is replaced when a template exists", async () => {
			const files = await plan(luau, "default", [
				"template.project.json",
				"default.project.json",
			]);

			expect(files.notes).toEqual([
				"Using template.project.json.",
				"Rogen replaces default.project.json on every build; move anything you need from it into template.project.json first.",
			]);
		});

		const withTemplate = async (
			template: TemplateChoice,
			copiedTemplate?: string
		) =>
			planProject({
				choices: {
					...(await defaultProjectChoices(
						luau,
						"default",
						new Set(),
						false
					)),
					template,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate,
			}).unwrap();

		it("should copy a hand-written project file to the template byte for byte", async () => {
			const content = '{ "name": "mine", "tree": {} }\n';
			const files = await withTemplate(
				{ kind: "copy", from: "default.project.json" },
				content
			);

			expect(files.template).toEqual({
				fileName: "template.project.json",
				content,
			});
			expect(configOf(files, "default.rogen.json").template).toBe(
				"template.project.json"
			);
			expect(files.notes).toEqual([
				"Copying default.project.json to template.project.json, since Rogen replaces default.project.json on every build.",
			]);
			expect(files.nextSteps.edits).not.toContainEqual(
				expect.stringContaining("Remove the nodes")
			);
		});

		it("should leave out of a copied template the nodes that point into the root dirs", async () => {
			const files = await withTemplate(
				{ kind: "copy", from: "default.project.json" },
				JSON.stringify({
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
				})
			);

			expect(JSON.parse(files.template?.content ?? "")).toEqual({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
					ServerScriptService: {
						$className: "ServerScriptService",
					},
					StarterPlayer: { StarterPlayerScripts: {} },
					Workspace: {},
				},
			});
			expect(files.notes).toEqual([
				"Copying default.project.json to template.project.json, since Rogen replaces default.project.json on every build.",
				"Left out ReplicatedStorage/Shared, ServerScriptService/Server, StarterPlayer/StarterPlayerScripts/Client and Workspace/Map, since they point into src and Rogen generates that code now.",
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

			const planDerived = async (content: object) => {
				const copiedTemplate = JSON.stringify({
					name: "my-game",
					tree: content,
				});
				const choices = await defaultProjectChoices(
					luau,
					"default",
					new Set(["default.project.json"]),
					false
				);
				const derived = DerivedRoutes.of(
					"default.project.json",
					copiedTemplate,
					choices.rootDirs
				);
				const starting = new StartingRoutes(
					workspaceOf(luau).languageFor("luau"),
					derived
				);
				return planProject({
					choices: {
						...choices,
						template: {
							kind: "copy",
							from: "default.project.json",
						},
						routes: starting.tickedByDefault,
					},
					projectName: "my-game",
					directory,
					existingFiles: new Set(["default.project.json"]),
					copiedTemplate,
				}).unwrap();
			};

			it("should write routes that put each folder where the project file had it", async () => {
				const files = await planDerived(tree);

				expect(configOf(files, "default.rogen.json").routes).toEqual({
					server: "ServerScriptService/Server",
					shared: "ReplicatedStorage/Shared",
					client: "StarterPlayer/StarterPlayerScripts/Client",
					"*": "ReplicatedStorage/Shared",
				});
			});

			it("should say it can't route a mount below a folder, and what to do instead", async () => {
				const files = await planDerived(tree);

				expect(files.notes).toContain(
					"Couldn't route ServerScriptService/Admin: only a folder directly in a root dir becomes a route. Give its folder a marker such as Admin@server, or move it up into a root dir."
				);
			});

			it("should name the folder of a mounted file for the marker, not the file", async () => {
				const files = await planDerived({
					ServerScriptService: {
						Main: { $path: "src/deep/Server/Main.server.luau" },
					},
				});

				expect(files.notes.join("\n")).toContain(
					"a marker such as Server@server"
				);
			});

			it("should say nothing about mounts it did route", async () => {
				const files = await planDerived({
					ServerScriptService: { Server: { $path: "src/server" } },
				});

				expect(files.notes.join("\n")).not.toContain("Couldn't route");
			});
		});

		it("should leave out of a copied template the nodes that point into the sync dir", async () => {
			const files = planProject({
				choices: {
					...(await defaultProjectChoices(
						{ ...luau, language: "roblox-ts" },
						"default",
						new Set(),
						false
					)),
					template: { kind: "copy", from: "default.project.json" },
					mounts: [],
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate: JSON.stringify({
					name: "my-game",
					tree: {
						$className: "DataModel",
						ServerScriptService: { TS: { $path: "out/server" } },
					},
				}),
			}).unwrap();

			expect(JSON.parse(files.template?.content ?? "").tree).toEqual({
				$className: "DataModel",
				ServerScriptService: {},
			});
			expect(files.notes[1]).toBe(
				"Left out ServerScriptService/TS, since it points into src or out and Rogen generates that code now."
			);
		});

		it("should write routes for the nodes it leaves out that point into the sync dir", async () => {
			const tsChoices = await defaultProjectChoices(
				{ ...luau, language: "roblox-ts" },
				"default",
				new Set(),
				false
			);
			const copiedTemplate = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ServerScriptService: { TS: { $path: "out/server" } },
				},
			});
			const starting = new StartingRoutes(
				workspaceOf(luau).languageFor("roblox-ts"),
				DerivedRoutes.of("default.project.json", copiedTemplate, [
					...tsChoices.rootDirs,
					"out",
				])
			);
			const files = planProject({
				choices: {
					...tsChoices,
					template: { kind: "copy", from: "default.project.json" },
					mounts: [],
					routes: starting.tickedByDefault,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate,
			}).unwrap();

			expect(configOf(files, "default.rogen.json").routes).toMatchObject({
				server: "ServerScriptService/TS",
			});
		});

		it("should leave out of a copied template the nodes that point into a place folder", async () => {
			const files = planProject({
				choices: {
					...(await defaultProjectChoices(
						luau,
						"default",
						new Set(),
						false
					)),
					template: { kind: "copy", from: "default.project.json" },
					places: [
						{
							name: "lobby",
							folder: new PlaceFolder(
								"places/lobby",
								false,
								false
							),
						},
					],
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate: JSON.stringify({
					name: "my-game",
					tree: {
						$className: "DataModel",
						ServerScriptService: {
							Lobby: { $path: "places/lobby/Server" },
						},
					},
				}),
			}).unwrap();

			expect(JSON.parse(files.template?.content ?? "").tree).toEqual({
				$className: "DataModel",
				ServerScriptService: {},
			});
		});

		it("should keep a $path that isn't a path", async () => {
			const files = await withTemplate(
				{ kind: "copy", from: "default.project.json" },
				JSON.stringify({
					name: "my-game",
					tree: { Odd: { $path: 5 }, Empty: { $path: {} } },
				})
			);

			expect(JSON.parse(files.template?.content ?? "").tree).toEqual({
				Odd: { $path: 5 },
				Empty: { $path: {} },
			});
		});

		it("should copy a template as it is when a root dir is the whole folder, and say what to remove", async () => {
			const content = JSON.stringify({
				name: "my-game",
				tree: { Shared: { $path: "shared" } },
			});
			const files = planProject({
				choices: {
					...(await defaultProjectChoices(
						luau,
						"default",
						new Set(),
						false
					)),
					template: { kind: "copy", from: "default.project.json" },
					rootDirs: ["."],
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate: content,
			}).unwrap();

			expect(files.template?.content).toBe(content);
			expect(files.nextSteps.edits[0]).toBe(
				"Remove the nodes in template.project.json that point into .; Rogen generates those now."
			);
		});

		it("should copy a template it can't parse as it is, and say what to remove", async () => {
			const content = '{ "name": "mine", "tree": ';
			const files = await withTemplate(
				{ kind: "copy", from: "default.project.json" },
				content
			);

			expect(files.template?.content).toBe(content);
			expect(files.nextSteps.edits[0]).toBe(
				"Remove the nodes in template.project.json that point into src; Rogen generates those now."
			);
		});

		const copyWithMounts = async (
			copiedTemplate: string,
			mountList: ProjectChoices["mounts"]
		) =>
			planProject({
				choices: {
					...(await defaultProjectChoices(
						luau,
						"default",
						new Set(),
						false
					)),
					template: { kind: "copy", from: "default.project.json" },
					mounts: mountList,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate,
			}).unwrap();

		it("should add the chosen package mounts a copied template lacks", async () => {
			const files = await copyWithMounts(
				JSON.stringify({
					name: "my-game",
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Assets: { $path: "assets" } },
					},
				}),
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

			expect(JSON.parse(files.template?.content ?? "").tree).toEqual({
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
				"Added Packages at ReplicatedStorage/Packages and ServerPackages at ServerScriptService/ServerPackages to template.project.json."
			);
		});

		it("should name every mount it adds under one node", async () => {
			const files = await copyWithMounts(
				JSON.stringify({ name: "my-game", tree: {} }),
				[
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
				]
			);

			expect(files.notes[1]).toBe(
				"Added include at ReplicatedStorage/rbxts_include and node_modules/@rbxts at ReplicatedStorage/rbxts_include/node_modules/@rbxts to template.project.json."
			);
		});

		it("should keep a copied template as it is when it already mounts the packages", async () => {
			const content = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Deps: { $path: "./Packages" } },
					ServerScriptService: {
						Server: { $path: "ServerPackages" },
					},
				},
			});
			const files = await copyWithMounts(content, [
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

			expect(files.template?.content).toBe(content);
			expect(files.notes).toHaveLength(1);
		});

		it("should not mount a folder inside one the template already mounts", async () => {
			const content = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						rbxts_include: {
							$path: "include",
							node_modules: { $path: "node_modules" },
						},
					},
				},
			});
			const files = await copyWithMounts(content, [
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

			expect(files.template?.content).toBe(content);
		});

		it("should say which mounts it left out because the template has a node in their place", async () => {
			const content = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "vendor" } },
				},
			});
			const files = await copyWithMounts(content, [
				{
					path: "Packages",
					optional: false,
					landing: "ReplicatedStorage/Packages",
				},
			]);

			expect(files.template?.content).toBe(content);
			expect(files.notes[1]).toBe(
				"Didn't add Packages at ReplicatedStorage/Packages to template.project.json, since it already has a node there."
			);
		});

		it("should say which packages to mount when it can't parse a copied template", async () => {
			const files = await copyWithMounts('{ "tree": ', [
				{
					path: "Packages",
					optional: false,
					landing: "ReplicatedStorage/Packages",
				},
			]);

			expect(files.nextSteps.edits).toContain(
				"Mount Packages in template.project.json; Rogen couldn't read it to add the mount."
			);
		});

		it("should reference a used project file as it is", async () => {
			const files = await withTemplate({
				kind: "use",
				file: "base.project.json",
			});

			expect(files.template).toBeUndefined();
			expect(configOf(files, "default.rogen.json").template).toBe(
				"base.project.json"
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
			).toBeUndefined();
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
