import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { DerivedRoutes } from "../derived-routes.js";
import { StartingRoutes } from "../starting-routes.js";

const luau = new StartingRoutes(workspaceOf().languageFor("luau"));
const rbxts = new StartingRoutes(workspaceOf().languageFor("roblox-ts"));

describe("domain/init/starting-routes", () => {
	describe("StartingRoutes", () => {
		it("should tick the server, client and shared routes to start with", () => {
			expect(StartingRoutes.DEFAULT).toEqual([
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
				JSON.stringify({
					name: "x",
					tree: {
						ServerScriptService: {
							Server: { $path: "src/server" },
						},
						ReplicatedStorage: { Shared: { $path: "src/shared" } },
					},
				}),
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
						key: "server",
						target: "ServerScriptService/Server",
						hint: "from default.project.json",
						ticked: true,
					},
					{
						id: "mount:shared",
						key: "shared",
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
					server: "ServerScriptService/Server",
					shared: "ReplicatedStorage/Shared",
					Client: "StarterPlayer/StarterPlayerScripts",
					"*": "ReplicatedStorage/Shared",
				});
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
