import { DerivedRoutes } from "../derived-routes.js";
import { StarterProject } from "../starter-project.js";

const project = (tree: object) =>
	StarterProject.parse(JSON.stringify({ name: "x", tree })).unwrap();

const RBX_TREE = {
	$className: "DataModel",
	ReplicatedStorage: { Shared: { $path: "src/shared" } },
	ServerScriptService: { Server: { $path: "src/server" } },
	StarterPlayer: {
		StarterPlayerScripts: { Client: { $path: "src/client" } },
	},
};

const derive = (tree: object, sourcePaths = ["src"]) =>
	DerivedRoutes.of(project(tree), sourcePaths);

describe("domain/init/derived-routes", () => {
	describe("DerivedRoutes", () => {
		it("should route each folder directly in a source path to where the project file mounted it", () => {
			const derived = derive(RBX_TREE);

			expect([...derived!.routes]).toEqual([
				["shared", "ReplicatedStorage/Shared"],
				["server", "ServerScriptService/Server"],
				["client", "StarterPlayer/StarterPlayerScripts/Client"],
			]);
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

		it("should have no fallback without a shared folder or a mounted source path", () => {
			const derived = derive({
				ServerScriptService: { Server: { $path: "src/server" } },
			});

			expect(derived?.fallback).toBeUndefined();
		});

		it("should name the folders routes take out of a node that mounted the whole source path", () => {
			const derived = derive({
				ReplicatedStorage: { Common: { $path: "src" } },
				ServerScriptService: { Server: { $path: "src/server" } },
			});

			expect(derived?.narrowed).toEqual({
				node: "ReplicatedStorage/Common",
				target: "src",
				folders: [
					{
						folder: "src/server",
						landing: "ServerScriptService/Server",
					},
				],
			});
		});

		it("should narrow nothing when no node mounted a whole source path", () => {
			expect(derive(RBX_TREE)?.narrowed).toBeUndefined();
		});

		it("should send files that match no route where the source path itself was mounted", () => {
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

		it("should find the folders of every source path", () => {
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
			it("should list a folder below one directly in a source path", () => {
				const derived = derive({
					ServerScriptService: {
						Admin: { $path: "src/server/Admin" },
					},
				});

				expect(derived?.routes.size).toBe(0);
				expect(derived?.unrouted).toMatchObject([
					{
						target: "src/server/Admin",
						node: "ServerScriptService/Admin",
						atRoot: false,
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

			it("should list a source path mounted somewhere no route can reach", () => {
				const derived = derive({
					Custom: { Common: { $path: "src" } },
				});

				expect(derived?.fallback).toBeUndefined();
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

		it("should ignore a mount outside the source paths", () => {
			expect(
				derive({
					ReplicatedStorage: { Packages: { $path: "Packages" } },
					ServerScriptService: { Out: { $path: "out/server" } },
				})
			).toBeUndefined();
		});

		it("should give up when there is nothing to route, or a source path is the whole folder", () => {
			expect(derive({ ReplicatedStorage: {} })).toBeUndefined();
			expect(derive(RBX_TREE, ["."])).toBeUndefined();
		});
	});
});
