import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { DerivedRoutes } from "../derived-routes.js";
import { StarterProject } from "../starter-project.js";
import { StartingRoutes } from "../starting-routes.js";

const luau = new StartingRoutes(workspaceOf().languageFor("luau"));
const rbxts = new StartingRoutes(workspaceOf().languageFor("roblox-ts"));

describe("domain/init/starting-routes", () => {
	describe("StartingRoutes", () => {
		it("should tick the server, client and shared routes to start with", () => {
			expect(luau.tickedByDefault).toEqual([
				"server",
				"client",
				"shared",
			]);
			expect(
				luau.options.filter(({ ticked }) => ticked).map(({ id }) => id)
			).toEqual(["server", "client", "shared"]);
		});

		it("should spell each key the way its language does", () => {
			expect(luau.options.map(({ key }) => key).slice(0, 3)).toEqual([
				"Server",
				"Client",
				"Shared",
			]);
			expect(rbxts.options.map(({ key }) => key).slice(0, 3)).toEqual([
				"server",
				"client",
				"shared",
			]);
		});

		it("should send shared code to a folder spelled like its key", () => {
			expect(luau.sharedTarget).toBe("ReplicatedStorage/Shared");
			expect(rbxts.sharedTarget).toBe("ReplicatedStorage/shared");
		});

		describe("with routes derived from a project file", () => {
			const derived = DerivedRoutes.of(
				"default.project.json",
				StarterProject.parse(
					JSON.stringify({
						name: "x",
						tree: {
							ServerScriptService: {
								Server: { $path: "src/server" },
							},
							ReplicatedStorage: {
								Shared: { $path: "src/shared" },
							},
						},
					})
				).unwrap(),
				["src"]
			);
			const routes = new StartingRoutes(
				workspaceOf().languageFor("luau"),
				derived
			);

			it("should offer them first, ticked, and say where they come from", () => {
				expect(routes.options.slice(0, 2)).toEqual([
					{
						id: "mount:server",
						key: "Server",
						target: "ServerScriptService/Server",
						hint: "from default.project.json",
						ticked: true,
					},
					{
						id: "mount:shared",
						key: "Shared",
						target: "ReplicatedStorage/Shared",
						hint: "from default.project.json",
						ticked: true,
					},
				]);
			});

			it("should replace the standard route of the same key and keep the rest", () => {
				expect(routes.options.map(({ id }) => id)).toEqual([
					"mount:server",
					"mount:shared",
					"client",
					"replicatedFirst",
					"serverStorage",
					"starterGui",
				]);
				expect(routes.tickedByDefault).toEqual([
					"mount:server",
					"mount:shared",
					"client",
				]);
			});

			it("should send files that match no route where the shared folder went", () => {
				expect(routes.fallbackTarget).toBe("ReplicatedStorage/Shared");
				expect(routes.starting(routes.tickedByDefault, true)).toEqual({
					Server: "ServerScriptService/Server",
					Shared: "ReplicatedStorage/Shared",
					Client: "StarterPlayer/StarterPlayerScripts",
					"*": "ReplicatedStorage/Shared",
				});
			});

			describe("the keys of derived routes", () => {
				const mounted = (language: "luau" | "roblox-ts") =>
					new StartingRoutes(
						workspaceOf().languageFor(language),
						DerivedRoutes.of(
							"default.project.json",
							StarterProject.parse(
								JSON.stringify({
									tree: {
										ServerScriptService: {
											server: { $path: "src/server" },
										},
										Workspace: {
											map: { $path: "src/map" },
											Lobby: { $path: "src/Lobby" },
										},
									},
								})
							).unwrap(),
							["src"]
						)
					);

				it("should share the casing of the standard routes in luau", () => {
					expect(
						mounted("luau")
							.options.slice(0, 3)
							.map(({ key }) => key)
					).toEqual(["Server", "Map", "Lobby"]);
				});

				it("should keep the folder's spelling in roblox-ts, but for a standard route", () => {
					expect(
						mounted("roblox-ts")
							.options.slice(0, 3)
							.map(({ key }) => key)
					).toEqual(["server", "map", "Lobby"]);
				});
			});

			it("should take a standard id for the derived route that replaced it", () => {
				expect(routes.resolve("server")).toBe("mount:server");
				expect(routes.resolve("client")).toBe("client");
				expect(routes.resolve("mount:server")).toBe("mount:server");
				expect(routes.resolve("nonsense")).toBe("nonsense");
			});

			it("should fall back to the standard place when it names none", () => {
				expect(luau.fallbackTarget).toBe("ReplicatedStorage/Shared");
			});
		});

		describe("starting", () => {
			it("should write the ticked routes and the fallback", () => {
				expect(luau.starting(["server", "shared"], true)).toEqual({
					Server: "ServerScriptService",
					Shared: "ReplicatedStorage/Shared",
					"*": "ReplicatedStorage/Shared",
				});
			});

			it("should leave the fallback out when asked to", () => {
				expect(luau.starting(["server"], false)).toEqual({
					Server: "ServerScriptService",
				});
			});

			it("should write the fallback anyway with no route ticked, since a config with none can't build", () => {
				expect(rbxts.starting([], false)).toEqual({
					"*": "ReplicatedStorage/shared",
				});
			});
		});
	});
});
