import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { DerivedRoutes } from "../derived-routes.js";
import { StarterProject } from "../starter-project.js";
import { StartingRoutes } from "../starting-routes.js";

const luau = new StartingRoutes(workspaceOf().languageFor("luau"));
const rbxts = new StartingRoutes(workspaceOf().languageFor("roblox-ts"));

const lifted = (tree: object) =>
	DerivedRoutes.of(
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

		it("should spell a standard key as the code already spells it, and the others in the same case", () => {
			const routes = new StartingRoutes(
				workspaceOf().languageFor("luau"),
				undefined,
				new Map([["server", "server"]])
			);

			expect(Object.keys(routes.routes)).toEqual([
				"server",
				"client",
				"shared",
				"*",
			]);
		});

		it("should give the keys the code doesn't spell its first letter's case only", () => {
			const routes = new StartingRoutes(
				workspaceOf().languageFor("roblox-ts"),
				undefined,
				new Map([["server", "SERVER"]])
			);

			expect(Object.keys(routes.routes)).toEqual([
				"SERVER",
				"Client",
				"Shared",
				"*",
			]);
		});

		it("should spell the keys the code doesn't spell the language's way when the code mixes cases", () => {
			const routes = new StartingRoutes(
				workspaceOf().languageFor("luau"),
				undefined,
				new Map([
					["server", "server"],
					["client", "Client"],
				])
			);

			expect(Object.keys(routes.routes)).toEqual([
				"server",
				"Client",
				"Shared",
				"*",
			]);
		});

		it.each([
			["server", "shared"],
			["Server", "Shared"],
		])(
			"should weigh a derived key with the code's spellings, so a derived %s gives %s",
			(derivedKey, shared) => {
				const routes = new StartingRoutes(
					workspaceOf().languageFor("luau"),
					lifted({
						ServerScriptService: {
							Server: { $path: `src/${derivedKey}` },
						},
					}),
					new Map([["client", "client"]])
				);

				expect(Object.keys(routes.routes)).toContain(shared);
			}
		);

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
					["server", "ServerScriptService/Server"],
					["shared", "ReplicatedStorage/Common"],
					["client", "StarterPlayer/StarterPlayerScripts"],
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

				it("should keep each folder's spelling, which a key must match exactly", () => {
					expect(mounted("luau")).toEqual(["server", "map", "Lobby"]);
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
