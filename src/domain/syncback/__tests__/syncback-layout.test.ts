import { layoutOf } from "./layout-fixtures.js";

describe("SyncbackLayout", () => {
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
