import { addedNode } from "../added-node.js";

const file = (path: string, text: string) => ({
	path: path.split("/"),
	text,
});

const folder = (path: string) => ({ path: path.split("/") });

describe("addedNode", () => {
	it("should make a node of a model file, in Rojo's node form", () => {
		expect(
			addedNode([
				file(
					"Buy.model.json",
					JSON.stringify({
						className: "RemoteEvent",
						properties: { Archivable: false },
						attributes: { Cost: { Float64: 5 } },
					})
				),
			])
		).toEqual({
			$className: "RemoteEvent",
			$properties: { Archivable: false },
			$attributes: { Cost: { Float64: 5 } },
		});
	});

	it("should keep a child named __proto__ as a child node", () => {
		const fromModel = addedNode([
			file(
				"Shop.model.json",
				JSON.stringify({
					className: "Configuration",
					children: [{ name: "__proto__", className: "RemoteEvent" }],
				})
			),
		]);
		const fromFolder = addedNode([
			folder("Shop"),
			file(
				"Shop/__proto__.model.json",
				JSON.stringify({ className: "RemoteEvent" })
			),
		]);

		expect(JSON.stringify(fromModel)).toBe(
			'{"$className":"Configuration","__proto__":{"$className":"RemoteEvent"}}'
		);
		expect(JSON.stringify(fromFolder)).toBe(
			'{"$className":"Folder","__proto__":{"$className":"RemoteEvent"}}'
		);
	});

	it("should make a node of each child a model file holds", () => {
		expect(
			addedNode([
				file(
					"Shop.model.json",
					JSON.stringify({
						className: "Configuration",
						children: [
							{ name: "Buy", className: "RemoteEvent" },
							{
								name: "Price",
								className: "IntValue",
								properties: { Value: 3 },
							},
						],
					})
				),
			])
		).toEqual({
			$className: "Configuration",
			Buy: { $className: "RemoteEvent" },
			Price: { $className: "IntValue", $properties: { Value: 3 } },
		});
	});

	it("should make a StringValue node of a text file and its meta file", () => {
		expect(
			addedNode([
				file("Label.txt", "hello"),
				file(
					"Label.meta.json",
					JSON.stringify({ attributes: { Shown: true } })
				),
			])
		).toEqual({
			$className: "StringValue",
			$properties: { Value: "hello" },
			$attributes: { Shown: true },
		});
	});

	it("should make a node of a folder and what it holds, with the class and properties of its init meta file", () => {
		expect(
			addedNode([
				file(
					"Group/init.meta.json",
					JSON.stringify({
						className: "Configuration",
						attributes: { Open: true },
					})
				),
				file(
					"Group/Ping.model.json",
					JSON.stringify({ className: "RemoteEvent" })
				),
				file("Group/Inner/Note.txt", "hi"),
				folder("Group/Empty"),
			])
		).toEqual({
			$className: "Configuration",
			$attributes: { Open: true },
			Ping: { $className: "RemoteEvent" },
			Inner: {
				$className: "Folder",
				Note: {
					$className: "StringValue",
					$properties: { Value: "hi" },
				},
			},
			Empty: { $className: "Folder" },
		});
	});

	it.each([
		["a script", [file("Run.server.luau", "print(1)")]],
		["a binary model", [file("Thing.rbxm", "")]],
		[
			"a folder that holds a script",
			[
				file(
					"Group/Ping.model.json",
					JSON.stringify({ className: "RemoteEvent" })
				),
				file("Group/Run.luau", "return 1"),
			],
		],
		["a folder that is a script", [file("Group/init.luau", "return 1")]],
		[
			"an instance that points at another",
			[
				file(
					"Ref.model.json",
					JSON.stringify({
						className: "ObjectValue",
						attributes: { Rojo_Target_Value: "70f2b930" },
					})
				),
			],
		],
		[
			"children that share a name",
			[
				file(
					"Pair.model.json",
					JSON.stringify({
						className: "Model",
						children: [
							{ name: "Block", className: "Part" },
							{ name: "Block", className: "Part" },
						],
					})
				),
			],
		],
		[
			"a model file with a key nodes don't have",
			[
				file(
					"Buy.model.json",
					JSON.stringify({ className: "RemoteEvent", id: "buy" })
				),
			],
		],
		["a model file that is no JSON", [file("Buy.model.json", "{")]],
	])("should make no node of %s", (_, entries) => {
		expect(addedNode(entries)).toBeUndefined();
	});
});
