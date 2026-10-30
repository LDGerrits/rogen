import { featureMetas } from "../feature-metas.js";
import { abs, layoutOf } from "./layout-fixtures.js";

const posix = (...segments: string[]) => abs(...segments).replaceAll("\\", "/");

const server = ["ServerScriptService", "Inventory"];
const shared = ["ReplicatedStorage", "Shared", "Inventory"];
const same = (a: string, b: string) => a === b;

describe("featureMetas", () => {
	it("should give a feature's only instance its feature folder", async () => {
		const layout = await layoutOf(["src/Inventory/Server/Bag.luau"]);

		expect(
			featureMetas(layout, [{ instance: server, edit: "a" }], same)
		).toEqual({
			placed: [
				{ folder: posix("src/Inventory"), instance: server, edit: "a" },
			],
			unplaced: [],
			homeless: [],
		});
	});

	it("should place an edit made alike on every instance of a feature once", async () => {
		const layout = await layoutOf([
			"src/Inventory/Server/Bag.luau",
			"src/Inventory/Shared/Item.luau",
		]);

		const metas = featureMetas(
			layout,
			[
				{ instance: server, edit: "a" },
				{ instance: shared, edit: "a" },
			],
			same
		);

		expect(metas.placed).toEqual([
			{ folder: posix("src/Inventory"), instance: server, edit: "a" },
		]);
		expect(metas.unplaced).toEqual([]);
	});

	it("should leave out an edit made on only some instances of a feature, naming the others", async () => {
		const layout = await layoutOf([
			"src/Inventory/Server/Bag.luau",
			"src/Inventory/Shared/Item.luau",
		]);

		const metas = featureMetas(
			layout,
			[{ instance: server, edit: "a" }],
			same
		);

		expect(metas.placed).toEqual([]);
		expect(metas.unplaced).toEqual([
			{
				instance: "ServerScriptService/Inventory",
				reason: expect.stringContaining(
					"ReplicatedStorage/Shared/Inventory"
				),
			},
		]);
	});

	it("should leave out edits that differ between the instances of a feature", async () => {
		const layout = await layoutOf([
			"src/Inventory/Server/Bag.luau",
			"src/Inventory/Shared/Item.luau",
		]);

		const metas = featureMetas(
			layout,
			[
				{ instance: server, edit: "a" },
				{ instance: shared, edit: "b" },
			],
			same
		);

		expect(metas.placed).toEqual([]);
		expect(metas.unplaced.map(({ instance }) => instance)).toEqual([
			"ServerScriptService/Inventory",
			"ReplicatedStorage/Shared/Inventory",
		]);
	});

	it("should hand back an edit on an instance no feature folder makes", async () => {
		const layout = await layoutOf(["src/Server/Loose.luau"]);
		const request = { instance: ["ServerScriptService"], edit: "a" };

		expect(featureMetas(layout, [request], same)).toEqual({
			placed: [],
			unplaced: [],
			homeless: [request],
		});
	});
});
