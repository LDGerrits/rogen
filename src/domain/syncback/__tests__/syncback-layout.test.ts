import { abs, layoutOf } from "./layout-fixtures.js";

const posix = (...segments: string[]) => abs(...segments).replaceAll("\\", "/");

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

	describe("featureMaking", () => {
		it("should find the feature folder whose routing folder makes the instance", async () => {
			const layout = await layoutOf([
				"src/Combat/Server/Main.server.luau",
				"src/Combat/Server/Damage/init.luau",
				"src/Combat/Server/Damage/Calc.luau",
			]);

			expect(
				layout.featureMaking(["ServerScriptService", "Combat"])
			).toEqual({
				folder: posix("src/Combat"),
				instances: [["ServerScriptService", "Combat"]],
			});
		});

		it("should list every instance the feature folder makes", async () => {
			const layout = await layoutOf([
				"src/Inventory/Server/Bag.luau",
				"src/Inventory/Save@server.luau",
				"src/Inventory/Shared/Item.luau",
			]);

			const feature = layout.featureMaking([
				"ServerScriptService",
				"Inventory",
			]);

			expect(feature?.folder).toBe(posix("src/Inventory"));
			expect(feature?.instances).toEqual(
				expect.arrayContaining([
					["ServerScriptService", "Inventory"],
					["ReplicatedStorage", "Shared", "Inventory"],
				])
			);
			expect(feature?.instances).toHaveLength(2);
		});

		it("should take a feature written only in names that spell the route", async () => {
			const layout = await layoutOf(["src/Inventory/Save@server.luau"]);

			expect(
				layout.featureMaking(["ServerScriptService", "Inventory"])
			).toEqual({
				folder: posix("src/Inventory"),
				instances: [["ServerScriptService", "Inventory"]],
			});
		});

		it("should find none for a folder below the feature's instance", async () => {
			const layout = await layoutOf([
				"src/Combat/Server/Sub/A.luau",
				"src/Combat/Server/Damage/init.luau",
			]);

			expect(
				layout.featureMaking(["ServerScriptService", "Combat", "Sub"])
			).toBeUndefined();
			expect(
				layout.featureMaking([
					"ServerScriptService",
					"Combat",
					"Damage",
				])
			).toBeUndefined();
		});

		it("should find none for an instance a script makes", async () => {
			const layout = await layoutOf([
				"src/Combat/Server/Util.luau",
				"src/Combat/Shared/X.luau",
				"src/Combat/Server/Hit/init.server.luau",
			]);

			expect(
				layout.featureMaking(["ServerScriptService", "Combat", "Hit"])
			).toBeUndefined();
		});

		it("should find none when the routing folder sits at the source path", async () => {
			const layout = await layoutOf(["src/Server/Loose.luau"]);

			expect(
				layout.featureMaking(["ServerScriptService"])
			).toBeUndefined();
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
