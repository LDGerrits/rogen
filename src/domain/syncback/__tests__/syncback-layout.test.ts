import { abs, layoutOf } from "./layout-fixtures.js";

describe("SyncbackLayout", () => {
	describe("homes", () => {
		it("should make a routing folder a home of the node it is", async () => {
			const layout = await layoutOf([
				"src/Combat/Server/Combat.luau",
				"src/Combat/Server/Util/Hit.luau",
				"src/Combat/Shared/Types.luau",
			]);

			expect(layout.homes).toEqual([
				{
					dir: abs("src/Combat/Shared").replaceAll("\\", "/"),
					node: ["ReplicatedStorage", "Shared", "Combat"],
				},
				{
					dir: abs("src/Combat/Server").replaceAll("\\", "/"),
					node: ["ServerScriptService", "Combat"],
				},
			]);
		});

		it("should make a routing folder at the source path a home of the service", async () => {
			const layout = await layoutOf(["src/Server/Main.luau"]);

			expect(layout.homes.map(({ node }) => node)).toEqual([
				["ServerScriptService"],
			]);
		});

		it("should leave a folder out when a file of another layout adds to its node", async () => {
			const layout = await layoutOf([
				"src/Inventory/Server/Bag.luau",
				"src/Inventory/Save@server.luau",
			]);

			expect(layout.homes).toEqual([]);
		});

		it("should leave a folder out that holds a group folder, a hoisted name or an @ name", async () => {
			expect(
				(await layoutOf(["src/A/Server/(Group)/X.luau"])).homes
			).toEqual([]);
			expect(
				(await layoutOf(["src/A/Server/^Hoist.luau"])).homes
			).toEqual([]);
			expect(
				(await layoutOf(["src/A/Server/Remote@Server.luau"])).homes
			).toEqual([]);
		});

		it("should leave out two folders that make one node, and the outer of two nodes", async () => {
			const twice = await layoutOf(
				["src/Inventory/Server/X.luau", "lib/Inventory/Server/Y.luau"],
				{ sourcePaths: [abs("src"), abs("lib")] }
			);
			const nested = await layoutOf([
				"src/Server/X.luau",
				"src/A/Server/Y.luau",
			]);

			expect(twice.homes).toEqual([]);
			expect(nested.homes.map(({ node }) => node)).toEqual([
				["ServerScriptService", "A"],
			]);
		});
		it("should put the homes in the sync path when a tool writes the files there", async () => {
			const layout = await layoutOf(["src/Combat/Server/Combat.luau"], {
				syncPath: abs("dist"),
			});

			expect(layout.homes).toEqual([
				{
					dir: abs("dist/Combat/Server").replaceAll("\\", "/"),
					node: ["ServerScriptService", "Combat"],
				},
			]);
		});
	});

	describe("donorsAt", () => {
		it("should describe how the files placed directly under a node were routed", async () => {
			const layout = await layoutOf([
				"src/Inventory/Server/Bag.luau",
				"src/Inventory/Save@server.luau",
			]);

			const donors = layout.donorsAt([
				"ServerScriptService",
				"Inventory",
			]);

			expect(
				donors.map(({ style, spelled }) => ({ style, spelled }))
			).toEqual(
				expect.arrayContaining([
					{ style: "folder", spelled: undefined },
					{ style: "suffix", spelled: "server" },
				])
			);
		});

		it("should find none under a node that only holds folders", async () => {
			const layout = await layoutOf(["src/Inventory/Server/Bag.luau"]);

			expect(layout.donorsAt(["ServerScriptService"])).toEqual([]);
		});
	});

	describe("folderNameFor", () => {
		it("should spell the routing folder as the project does, else as the key", async () => {
			const layout = await layoutOf(["src/A/server/X.luau"], {
				routes: {
					Server: "ServerScriptService",
					"*": "ReplicatedStorage",
				},
			});

			expect(layout.folderNameFor("Server")).toBe("server");
			expect(layout.folderNameFor("Client")).toBe("Client");
		});
	});
});
