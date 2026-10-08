import { DerivedRoutes } from "../derived-routes.js";

const project = (tree: object) => JSON.stringify({ name: "x", tree });

const RBX_TREE = {
	$className: "DataModel",
	ReplicatedStorage: { Shared: { $path: "src/shared" } },
	ServerScriptService: { Server: { $path: "src/server" } },
	StarterPlayer: {
		StarterPlayerScripts: { Client: { $path: "src/client" } },
	},
};

const derive = (tree: object, rootDirs = ["src"]) =>
	DerivedRoutes.of("default.project.json", project(tree), rootDirs);

describe("domain/init/derived-routes", () => {
	describe("DerivedRoutes", () => {
		it("should route each folder directly in a root dir to where the project file mounted it", () => {
			const derived = derive(RBX_TREE);

			expect([...derived!.routes]).toEqual([
				["shared", "ReplicatedStorage/Shared"],
				["server", "ServerScriptService/Server"],
				["client", "StarterPlayer/StarterPlayerScripts/Client"],
			]);
			expect(derived?.from).toBe("default.project.json");
		});

		it("should send files that match no route where the shared folder went", () => {
			expect(derive(RBX_TREE)?.fallback).toBe("ReplicatedStorage/Shared");
		});

		it("should match the shared route in any letter case", () => {
			const derived = derive({
				ReplicatedStorage: { Common: { $path: "src/Shared" } },
			});

			expect(derived?.fallback).toBe("ReplicatedStorage/Common");
		});

		it("should have no fallback without a shared folder or a mounted root dir", () => {
			const derived = derive({
				ServerScriptService: { Server: { $path: "src/server" } },
			});

			expect(derived?.fallback).toBeUndefined();
		});

		it("should send files that match no route where the root dir itself was mounted", () => {
			const derived = derive({
				ReplicatedStorage: {
					Common: { $path: "src" },
					Shared: { $path: "src/shared" },
				},
			});

			expect(derived?.fallback).toBe("ReplicatedStorage/Common");
			expect([...derived!.routes]).toEqual([
				["shared", "ReplicatedStorage/Shared"],
			]);
		});

		it("should read an optional path and one written with a leading dot", () => {
			const derived = derive({
				ServerScriptService: {
					Server: { $path: { optional: "./src/server/" } },
				},
			});

			expect([...derived!.routes]).toEqual([
				["server", "ServerScriptService/Server"],
			]);
		});

		it("should find the folders of every root dir", () => {
			const derived = derive(
				{
					ServerScriptService: {
						Server: { $path: "src/server" },
						Lobby: { $path: "places/lobby" },
					},
				},
				["src", "places"]
			);

			expect([...derived!.routes.keys()]).toEqual(["server", "lobby"]);
		});

		describe("a mount it can't route", () => {
			it("should list a folder below one directly in a root dir", () => {
				const derived = derive({
					ServerScriptService: {
						Admin: { $path: "src/server/Admin" },
					},
				});

				expect(derived?.routes.size).toBe(0);
				expect(derived?.unrouted).toEqual([
					{
						target: "src/server/Admin",
						node: "ServerScriptService/Admin",
					},
				]);
			});

			it("should list a folder whose name can't be a route key", () => {
				const derived = derive({
					ServerScriptService: { Mine: { $path: "src/my-game" } },
				});

				expect(derived?.routes.size).toBe(0);
				expect(derived?.unrouted).toHaveLength(1);
			});

			it("should keep the first of two folders that differ only in the first letter's case", () => {
				const derived = derive({
					ServerScriptService: { A: { $path: "src/server" } },
					ReplicatedStorage: { B: { $path: "src/Server" } },
				});

				expect([...derived!.routes]).toEqual([
					["server", "ServerScriptService/A"],
				]);
				expect(derived?.unrouted).toHaveLength(1);
			});

			it("should list a mount that isn't under a service", () => {
				const derived = derive({
					Custom: { Server: { $path: "src/server" } },
				});

				expect(derived?.routes.size).toBe(0);
				expect(derived?.unrouted).toHaveLength(1);
			});
		});

		it("should ignore a mount outside the root dirs", () => {
			expect(
				derive({
					ReplicatedStorage: { Packages: { $path: "Packages" } },
					ServerScriptService: { Out: { $path: "out/server" } },
				})
			).toBeUndefined();
		});

		it("should give up when there is no project file, nothing to route, or a root dir is the whole folder", () => {
			expect(
				DerivedRoutes.of("default.project.json", "{ nope", ["src"])
			).toBeUndefined();
			expect(derive({ ReplicatedStorage: {} })).toBeUndefined();
			expect(derive(RBX_TREE, ["."])).toBeUndefined();
		});
	});
});
