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

	it("should give the feature folder of a routing folder spelled with `@`", async () => {
		const layout = await layoutOf(["src/Inventory/@Server/Bag.luau"]);

		expect(
			featureMetas(layout, [{ instance: server, edit: "a" }], same).placed
		).toEqual([
			{ folder: posix("src/Inventory"), instance: server, edit: "a" },
		]);
	});

	it("should skip an invisible folder that holds the routing folder", async () => {
		const layout = await layoutOf([
			"src/Inventory/(Logic)/Server/Bag.luau",
		]);

		expect(
			featureMetas(layout, [{ instance: server, edit: "a" }], same).placed
		).toEqual([
			{ folder: posix("src/Inventory"), instance: server, edit: "a" },
		]);
	});

	it("should not count an invisible folder in the routing folder as a level", async () => {
		const layout = await layoutOf(["src/Inventory/Server/(Ui)/Bag.luau"]);
		const service = { instance: ["ServerScriptService"], edit: "a" };

		expect(
			featureMetas(
				layout,
				[service, { instance: server, edit: "b" }],
				same
			)
		).toEqual({
			placed: [
				{ folder: posix("src/Inventory"), instance: server, edit: "b" },
			],
			unplaced: [],
			homeless: [service],
		});
	});

	it("should not take a hoisted file's target for its feature", async () => {
		const layout = await layoutOf([
			"src/Player/Client/^Animate.client.luau",
			"src/Player/Client/Sprint.client.luau",
		]);
		const scripts = {
			instance: ["StarterPlayer", "StarterPlayerScripts"],
			edit: "a",
		};
		const player = ["StarterPlayer", "StarterPlayerScripts", "Player"];

		expect(
			featureMetas(
				layout,
				[scripts, { instance: player, edit: "b" }],
				same
			)
		).toEqual({
			placed: [
				{ folder: posix("src/Player"), instance: player, edit: "b" },
			],
			unplaced: [],
			homeless: [scripts],
		});
	});

	it("should give the feature folder of a routing folder in parentheses", async () => {
		const layout = await layoutOf(["src/Inventory/(Server)/Bag.luau"]);

		expect(
			featureMetas(layout, [{ instance: server, edit: "a" }], same).placed
		).toEqual([
			{ folder: posix("src/Inventory"), instance: server, edit: "a" },
		]);
	});

	it("should not count a routing folder that restates its route as a level", async () => {
		const layout = await layoutOf([
			"src/Inventory/Server/@Server/Bag.luau",
		]);
		const service = { instance: ["ServerScriptService"], edit: "a" };

		expect(featureMetas(layout, [service], same).homeless).toEqual([
			service,
		]);
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
