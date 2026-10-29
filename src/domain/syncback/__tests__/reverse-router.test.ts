import { ReverseRouter } from "../reverse-router.js";
import { ROUTES, abs, layoutOf } from "./layout-fixtures.js";

const posix = (...segments: string[]) => abs(...segments).replaceAll("\\", "/");

const routerOf = async (
	files: readonly string[],
	spec: Parameters<typeof layoutOf>[1] = {}
) => new ReverseRouter(await layoutOf(files, spec));

const mail = {
	parent: ["ServerScriptService", "Inventory"],
	name: "Mail",
	folder: false,
};

const quest = { parent: ["ServerScriptService"], name: "Quest", folder: true };

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
				home: { dir: posix("src/Inventory/Server"), contents: false },
			});
		});

		it("should write into the compiled path when a tool writes the files there", async () => {
			const router = await routerOf(["src/Inventory/Server/Bag.luau"], {
				compiledPath: abs("dist"),
			});

			expect(
				router.place({
					parent: ["ServerScriptService", "Inventory"],
					name: "Mail",
					folder: false,
				})
			).toMatchObject({ home: { dir: posix("dist/Inventory/Server") } });
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
					mark: { text: "@server", route: "Server" },
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

		it("should follow the most files when the files beside it disagree", async () => {
			const router = await routerOf([
				"src/Inventory/Server/Bag.luau",
				"src/Inventory/Server/Cart.luau",
				"src/Inventory/Save@server.luau",
			]);

			expect(router.place(mail)).toEqual({
				kind: "placed",
				home: { dir: posix("src/Inventory/Server"), contents: false },
			});
		});

		it("should let its relatives decide a tie beside it", async () => {
			const router = await routerOf([
				"src/Inventory/Server/Bag.luau",
				"src/Inventory/Save@server.luau",
				"src/Combat/Hit@server.luau",
			]);

			expect(router.place(mail)).toMatchObject({
				kind: "placed",
				home: {
					dir: posix("src/Inventory"),
					mark: { text: "@server" },
				},
			});
		});

		it("should write folders when nothing decides the style", async () => {
			const router = await routerOf([
				"src/Inventory/Server/Bag.luau",
				"src/Inventory/Save@server.luau",
			]);

			expect(router.place(mail)).toEqual({
				kind: "placed",
				home: { dir: posix("src/Inventory/Server"), contents: false },
			});
		});

		it("should refuse when files beside it in one style lie in two folders as often", async () => {
			const router = await routerOf(
				[
					"src/Inventory/Server/Bag.luau",
					"lib/Inventory/Server/Cart.luau",
				],
				{ sourcePaths: [abs("src"), abs("lib")] }
			);

			expect(router.place(mail)).toMatchObject({
				kind: "conflict",
				reason: expect.stringContaining("more than one place"),
			});
		});

		it("should place by a fixed order when no style decides a tie", async () => {
			const router = await routerOf([
				"src/Net/B.luau",
				"src/Net/C@shared.luau",
				"src/X/Shared/One.luau",
				"src/X/Shared/Two.luau",
			]);

			expect(
				router.place({
					parent: ["ReplicatedStorage", "Shared", "Net"],
					name: "D",
					folder: false,
				})
			).toMatchObject({
				kind: "placed",
				home: { dir: posix("src/Net"), mark: { text: "@shared" } },
			});
		});

		it("should write into the folder of an init file that makes the parent", async () => {
			const router = await routerOf([
				"src/Inventory/Server/Bag.luau",
				"src/Inventory/Server/Shop/init.luau",
			]);

			expect(
				router.place({
					parent: ["ServerScriptService", "Inventory", "Shop"],
					name: "Item",
					folder: false,
				})
			).toEqual({
				kind: "placed",
				home: {
					dir: posix("src/Inventory/Server/Shop"),
					contents: false,
				},
			});
		});

		it("should refuse when a file that holds no other files makes the parent", async () => {
			const router = await routerOf([
				"src/Inventory/Bag@server.luau",
				"src/Inventory/Sub@server.luau",
			]);

			expect(
				router.place({
					parent: ["ServerScriptService", "Inventory", "Sub"],
					name: "Mail",
					folder: false,
				})
			).toMatchObject({
				kind: "conflict",
				reason: expect.stringContaining("Sub@server.luau"),
			});
		});

		it("should go below files named for their route, naming the new one so", async () => {
			const router = await routerOf(["src/Inventory/Bag@server.luau"]);

			expect(
				router.place({
					parent: ["ServerScriptService", "Inventory", "Sub"],
					name: "Mail",
					folder: false,
				})
			).toMatchObject({
				kind: "placed",
				home: {
					dir: posix("src/Inventory/Sub"),
					mark: { text: "@server" },
				},
			});
		});
	});

	describe("the style of a new feature", () => {
		it("should name each file of a new folder for its route when its relatives are", async () => {
			const router = await routerOf([
				"src/Inventory/Bag@server.luau",
				"src/Inventory/Save@server.luau",
			]);

			expect(router.place(quest)).toEqual({
				kind: "placed",
				home: {
					dir: posix("src"),
					contents: false,
					mark: { text: "@server", route: "Server" },
				},
			});
		});

		it("should take the style of the features under the same route over the rest of the project", async () => {
			const router = await routerOf([
				"src/Inventory/Bag@server.luau",
				"src/Inventory/Hud/Client/A.luau",
				"src/Inventory/Hud/Client/B.luau",
				"src/Combat/Client/C.luau",
			]);

			expect(router.place(quest)).toMatchObject({
				home: { mark: { text: "@server" } },
			});
			expect(
				router.place({
					parent: ["StarterPlayer", "StarterPlayerScripts"],
					name: "Menu",
					folder: true,
				})
			).toEqual({
				kind: "placed",
				home: { dir: posix("src/Menu/Client"), contents: true },
			});
		});

		it("should take the style of the whole project when its relatives have none, spelled as it spells routes", async () => {
			const router = await routerOf(["src/Hud/Ui@client.luau"]);

			expect(router.place(quest)).toMatchObject({
				home: { dir: posix("src"), mark: { text: "@server" } },
			});
		});

		it("should spell the route as the project's names do", async () => {
			const router = await routerOf([
				"src/Inventory/Bag@server.luau",
				"src/Hud/Ui@client.luau",
			]);

			expect(router.place(quest)).toMatchObject({
				home: { mark: { text: "@server" } },
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
				home: { dir: posix("src/Quest/Server"), contents: true },
			});
		});

		it("should keep a folder that is a script as a folder in the routing folder", async () => {
			const router = await routerOf(["src/Inventory/Server/Bag.luau"]);

			expect(
				router.place({
					...quest,
					files: [
						["Quest", "init.luau"],
						["Quest", "A.luau"],
					],
				})
			).toEqual({
				kind: "placed",
				home: { dir: posix("src/Server"), contents: false },
			});
		});

		it("should make a feature folder for a folder whose script is in a folder below it", async () => {
			const router = await routerOf(["src/Inventory/Server/Bag.luau"]);

			expect(
				router.place({
					...quest,
					files: [
						["Quest", "Tracker", "init.luau"],
						["Quest", "Tracker", "Child.luau"],
					],
				})
			).toEqual({
				kind: "placed",
				home: { dir: posix("src/Quest/Server"), contents: true },
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
				home: { dir: posix("src"), contents: false },
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

	describe("destination", () => {
		const unit = (folder: boolean, files: string[][] = []) => ({
			parent: ["ServerScriptService"],
			name: folder ? "Quest" : "Boot",
			folder,
			files,
		});
		const server = { text: "@server", route: "Server" };
		const destination = async (
			instance: ReturnType<typeof unit>,
			file: string[],
			home: { contents: boolean; mark?: typeof server }
		) =>
			(await routerOf(["src/A/Server/X.luau"])).destination(
				instance,
				file,
				{ dir: posix("src"), ...home }
			);

		it("should drop a folder when the routing folder stands for it", async () => {
			expect(
				await destination(unit(true), ["Quest", "Util", "A.luau"], {
					contents: true,
				})
			).toEqual(["Util", "A.luau"]);
		});

		it("should mark the name of a file and its meta file", async () => {
			const boot = unit(false, [["Boot.luau"], ["Boot.meta.json"]]);
			expect(
				await destination(boot, ["Boot.meta.json"], {
					contents: false,
					mark: server,
				})
			).toEqual(["Boot@server.meta.json"]);
		});

		it("should mark each file of a folder, or the folder when a script is in it", async () => {
			const files = [
				["Quest", "Main.luau"],
				["Quest", "Util", "A.luau"],
			];
			const marked = { contents: false, mark: server };

			expect(
				await destination(unit(true, files), files[0], marked)
			).toEqual(["Quest", "Main@server.luau"]);
			expect(
				await destination(unit(true, files), files[1], marked)
			).toEqual(["Quest", "Util", "A@server.luau"]);
			expect(
				await destination(
					unit(true, [["Quest", "init.luau"]]),
					["Quest", "init.luau"],
					marked
				)
			).toEqual(["Quest@server", "init.luau"]);
			const nested = [
				["Quest", "Main.luau"],
				["Quest", "Util", "init.meta.json"],
			];
			expect(
				await destination(unit(true, nested), nested[1], marked)
			).toEqual(["Quest@server", "Util", "init.meta.json"]);
		});

		it("should read only a script suffix as routing, not the kind of a file", async () => {
			const router = await routerOf(["src/A/Server/X.luau"], {
				routes: { ...ROUTES, model: "Workspace" },
			});

			expect(
				router.destination(
					unit(false, [["Boot.model.json"]]),
					["Boot.model.json"],
					{
						dir: posix("src"),
						contents: false,
						mark: { text: "@model", route: "model" },
					}
				)
			).toEqual(["Boot@model.model.json"]);
		});

		it("should not mark a script whose suffix already routes it there, nor its meta file", async () => {
			const boot = unit(false, [
				["Boot.server.luau"],
				["Boot.meta.json"],
			]);
			const home = { contents: false, mark: server };

			expect(await destination(boot, ["Boot.server.luau"], home)).toEqual(
				["Boot.server.luau"]
			);
			expect(await destination(boot, ["Boot.meta.json"], home)).toEqual([
				"Boot.meta.json",
			]);
			expect(
				await destination(
					unit(false, [["Boot.client.luau"]]),
					["Boot.client.luau"],
					home
				)
			).toEqual(["Boot@server.client.luau"]);
		});

		it("should keep a name when there is no mark", async () => {
			expect(
				await destination(unit(false), ["Boot.luau"], {
					contents: false,
				})
			).toEqual(["Boot.luau"]);
		});
	});
});
