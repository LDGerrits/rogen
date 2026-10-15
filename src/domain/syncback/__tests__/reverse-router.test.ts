import { ReverseRouter } from "../reverse-router.js";
import { ROUTES, abs, layoutOf } from "./layout-fixtures.js";

const posix = (...segments: string[]) => abs(...segments).replaceAll("\\", "/");

const routerOf = async (
	files: readonly string[],
	spec: Parameters<typeof layoutOf>[1] = {}
) => new ReverseRouter(await layoutOf(files, spec));

describe("ReverseRouter", () => {
	describe("beside files already at the parent", () => {
		it("should write into the routing folder the siblings are in", async () => {
			const router = await routerOf(["src/Inventory/Server/Bag.luau"]);

			expect(
				router.place({
					parent: ["ServerScriptService", "Inventory"],
					name: "Mail",
					folder: false,
				})
			).toEqual({
				kind: "placed",
				home: {
					dir: posix("src/Inventory/Server"),
					contents: false,
					mark: "",
				},
			});
		});

		it("should name the route the way siblings do when they are named for it", async () => {
			const router = await routerOf([
				"src/Inventory/Bag@server.luau",
				"src/Inventory/Save@server.luau",
			]);

			expect(
				router.place({
					parent: ["ServerScriptService", "Inventory"],
					name: "Mail",
					folder: false,
				})
			).toEqual({
				kind: "placed",
				home: {
					dir: posix("src/Inventory"),
					contents: false,
					mark: "@server",
				},
			});
		});

		it("should go below the nearest ancestor that has files, with the folders between", async () => {
			const router = await routerOf(["src/Inventory/Server/Bag.luau"]);

			expect(
				router.place({
					parent: ["ServerScriptService", "Inventory", "Util"],
					name: "Tools",
					folder: false,
				})
			).toMatchObject({
				kind: "placed",
				home: { dir: posix("src/Inventory/Server/Util") },
			});
		});

		it("should refuse when the files beside it are in more than one place", async () => {
			const router = await routerOf([
				"src/Inventory/Server/Bag.luau",
				"src/Inventory/Save@server.luau",
			]);

			const placement = router.place({
				parent: ["ServerScriptService", "Inventory"],
				name: "Mail",
				folder: false,
			});

			expect(placement).toMatchObject({
				kind: "conflict",
				reason: expect.stringContaining("more than one place"),
			});
		});
	});

	describe("as a new feature", () => {
		it("should make a feature folder with the routing folder inside for a folder", async () => {
			const router = await routerOf(["src/Inventory/Server/Bag.luau"]);

			expect(
				router.place({
					parent: ["ServerScriptService"],
					name: "Quest",
					folder: true,
				})
			).toEqual({
				kind: "placed",
				home: {
					dir: posix("src/Quest/Server"),
					contents: true,
					mark: "",
				},
			});
		});

		it("should put a file in the routing folder of the source path", async () => {
			const router = await routerOf(["src/Inventory/Server/Bag.luau"]);

			expect(
				router.place({
					parent: ["ServerScriptService"],
					name: "Boot",
					folder: false,
				})
			).toMatchObject({
				kind: "placed",
				home: { dir: posix("src/Server"), contents: false },
			});
		});

		it("should take the deepest route, and a keyed route over the fallback", async () => {
			const router = await routerOf(["src/A/Shared/X.luau"]);

			expect(
				router.place({
					parent: ["ReplicatedStorage", "Shared", "Net"],
					name: "Remote",
					folder: false,
				})
			).toMatchObject({
				kind: "placed",
				home: { dir: posix("src/Net/Shared") },
			});
		});

		it("should write plainly into the source path when only the fallback route reaches it", async () => {
			const router = await routerOf(["src/A.luau"], {
				routes: { "*": "ReplicatedStorage" },
			});

			expect(
				router.place({
					parent: ["ReplicatedStorage"],
					name: "Types",
					folder: false,
				})
			).toMatchObject({
				kind: "placed",
				home: { dir: posix("src"), contents: false, mark: "" },
			});
		});

		it("should refuse when no route reaches the parent", async () => {
			const router = await routerOf(["src/A/Server/X.luau"]);

			expect(
				router.place({
					parent: ["Workspace"],
					name: "Map",
					folder: true,
				})
			).toMatchObject({
				kind: "conflict",
				reason: "no route puts files where its parent is",
			});
		});

		it("should refuse when two keyed routes reach the same place", async () => {
			const router = await routerOf(["src/A/Server/X.luau"], {
				routes: { ...ROUTES, Admin: "ServerScriptService" },
			});

			expect(
				router.place({
					parent: ["ServerScriptService"],
					name: "Quest",
					folder: true,
				})
			).toMatchObject({
				kind: "conflict",
				reason: expect.stringContaining("more than one route"),
			});
		});

		it("should refuse when several source paths could hold it", async () => {
			const router = await routerOf(["src/A/Server/X.luau"], {
				sourcePaths: [abs("src"), abs("lib")],
			});

			expect(
				router.place({
					parent: ["ServerScriptService"],
					name: "Quest",
					folder: true,
				})
			).toMatchObject({
				kind: "conflict",
				reason: expect.stringContaining("source path"),
			});
		});
	});
});
