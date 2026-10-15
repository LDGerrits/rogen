import { StagedUnits } from "../staged-units.js";

const NODES = [["ServerScriptService"], ["ServerScriptService", "Inventory"]];

describe("StagedUnits", () => {
	it("should group the files of one instance, a folder's files and a file's companions", () => {
		const { units, strays } = StagedUnits.of(
			[
				["0", "Quest", "Main.luau"],
				["0", "Quest", "Side.luau"],
				["0", "Boot.server.luau"],
				["0", "Boot.meta.json"],
			],
			NODES
		);

		expect(strays).toEqual([]);
		expect(units).toEqual([
			{
				number: 0,
				parent: ["ServerScriptService"],
				name: "Quest",
				folder: true,
				files: [
					["Quest", "Main.luau"],
					["Quest", "Side.luau"],
				],
			},
			{
				number: 0,
				parent: ["ServerScriptService"],
				name: "Boot",
				folder: false,
				files: [["Boot.server.luau"], ["Boot.meta.json"]],
			},
		]);
	});

	it("should name a staged node by its number", () => {
		const { units } = StagedUnits.of([["1", "Mail.luau"]], NODES);

		expect(units[0].parent).toEqual(["ServerScriptService", "Inventory"]);
	});

	it("should report what no staged node holds as a stray", () => {
		const { units, strays } = StagedUnits.of(
			[["9", "X.luau"], ["0"]],
			NODES
		);

		expect(units).toEqual([]);
		expect(strays).toEqual(["9/X.luau", "0"]);
	});
});
