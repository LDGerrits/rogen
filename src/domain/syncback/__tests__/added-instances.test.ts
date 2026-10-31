import { addedInstances } from "../added-instances.js";

const asNames = (folder: string) => folder.split("/");

const known =
	(...folders: string[]) =>
	(folder: string) =>
		folders.includes(folder);

describe("addedInstances", () => {
	it("should make each new file below a known folder an instance named without its suffix", () => {
		const { instances } = addedInstances(
			[
				{
					path: "ServerScriptService/Inventory/Mail.luau",
					folder: false,
				},
				{
					path: "ServerScriptService/Inventory/Mail.meta.json",
					folder: false,
				},
			],
			known("ServerScriptService", "ServerScriptService/Inventory"),
			asNames
		);

		expect(instances).toEqual([
			{
				parent: ["ServerScriptService", "Inventory"],
				name: "Mail",
				folder: false,
				files: [["Mail.luau"], ["Mail.meta.json"]],
				parentFolder: "ServerScriptService/Inventory",
			},
		]);
	});

	it("should make a new folder one instance with every file below it", () => {
		const { instances } = addedInstances(
			[
				{ path: "ServerScriptService/Quest/Main.luau", folder: false },
				{
					path: "ServerScriptService/Quest/Util/A.luau",
					folder: false,
				},
				{ path: "ServerScriptService/Quest/Empty", folder: true },
			],
			known("ServerScriptService"),
			asNames
		);

		expect(instances).toEqual([
			{
				parent: ["ServerScriptService"],
				name: "Quest",
				folder: true,
				files: [
					["Quest", "Main.luau"],
					["Quest", "Util", "A.luau"],
					["Quest", "Empty"],
				],
				parentFolder: "ServerScriptService",
			},
		]);
	});

	it("should make an empty new folder an instance of its own", () => {
		const { instances } = addedInstances(
			[{ path: "ServerScriptService/Empty", folder: true }],
			known("ServerScriptService"),
			asNames
		);

		expect(instances).toMatchObject([{ name: "Empty", folder: true }]);
	});

	it("should call a path below no known folder a stray", () => {
		expect(
			addedInstances(
				[{ path: "Workspace/Map.luau", folder: false }],
				known(),
				asNames
			).strays
		).toEqual(["Workspace/Map.luau"]);
	});
});
