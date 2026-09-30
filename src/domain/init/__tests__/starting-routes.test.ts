import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
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
