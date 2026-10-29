import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { DerivedRoutes } from "../derived-routes.js";
import { StarterProject } from "../starter-project.js";
import { StartingRoutes } from "../starting-routes.js";

const luau = new StartingRoutes(workspaceOf().languageFor("luau"));
const rbxts = new StartingRoutes(workspaceOf().languageFor("roblox-ts"));

const lifted = (tree: object) =>
	DerivedRoutes.of(
		"default.project.json",
		StarterProject.parse(JSON.stringify({ name: "x", tree })).unwrap(),
		["src"]
	);

describe("domain/init/starting-routes", () => {
	describe("StartingRoutes", () => {
		it("should start with the server, client, shared and * routes, spelled the way the language does", () => {
			expect(luau.routes).toEqual({
				Server: "ServerScriptService",
				Client: "StarterPlayer/StarterPlayerScripts",
				Shared: "ReplicatedStorage/Shared",
				"*": "ReplicatedStorage/Shared",
			});
			expect(rbxts.routes).toEqual({
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				shared: "ReplicatedStorage/shared",
				"*": "ReplicatedStorage/shared",
			});
		});

		describe("with routes derived from a project file", () => {
			it("should put them first, replace the standard route of the same key, and send * where the shared folder went", () => {
				const routes = new StartingRoutes(
					workspaceOf().languageFor("luau"),
					lifted({
						ServerScriptService: {
							Server: { $path: "src/server" },
						},
						ReplicatedStorage: {
							Common: { $path: "src/shared" },
						},
					})
				);

				expect(Object.entries(routes.routes)).toEqual([
					["Server", "ServerScriptService/Server"],
					["Shared", "ReplicatedStorage/Common"],
					["Client", "StarterPlayer/StarterPlayerScripts"],
					["*", "ReplicatedStorage/Common"],
				]);
			});

			describe("the keys of derived routes", () => {
				const mounted = (language: "luau" | "roblox-ts") =>
					Object.keys(
						new StartingRoutes(
							workspaceOf().languageFor(language),
							lifted({
								ServerScriptService: {
									server: { $path: "src/server" },
								},
								Workspace: {
									map: { $path: "src/map" },
									Lobby: { $path: "src/Lobby" },
								},
							})
						).routes
					).slice(0, 3);

				it("should share the casing of the standard routes in luau", () => {
					expect(mounted("luau")).toEqual(["Server", "Map", "Lobby"]);
				});

				it("should keep the folder's spelling in roblox-ts, but for a standard route", () => {
					expect(mounted("roblox-ts")).toEqual([
						"server",
						"map",
						"Lobby",
					]);
				});
			});
		});
	});
});
