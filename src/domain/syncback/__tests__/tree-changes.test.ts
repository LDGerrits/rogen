import { RojoNode } from "../../rojo/rojo-project.js";
import { applyTreeChanges, treeChanges } from "../tree-changes.js";

describe("treeChanges", () => {
	it("should find nothing when the trees are the same", () => {
		const tree: RojoNode = {
			$className: "Folder",
			Child: { $path: "mirror/a.txt", $properties: { Value: "x" } },
		};

		expect(treeChanges(tree, structuredClone(tree))).toEqual([]);
	});

	it("should find a property Rojo set on a node, leaving $path alone", () => {
		const before: RojoNode = {
			$className: "Folder",
			Child: { $path: "mirror/a.txt" },
		};
		const after: RojoNode = {
			$className: "Folder",
			Child: { $path: "elsewhere", $attributes: { Level: 3 } },
		};

		expect(treeChanges(before, after)).toEqual([
			{
				node: ["Child"],
				set: { $attributes: { Level: 3 } },
				remove: [],
				added: [],
			},
		]);
	});

	it("should not count the same data in another key order as a change", () => {
		const before: RojoNode = {
			$properties: { A: 1, B: { X: 1, Y: 2 } },
		};
		const after: RojoNode = {
			$properties: { B: { Y: 2, X: 1 }, A: 1 },
		};

		expect(treeChanges(before, after)).toEqual([]);
	});

	it("should not count a key other than the properties and attributes that Rojo left out", () => {
		const before: RojoNode = {
			$className: "Folder",
			$ignoreUnknownInstances: false,
		};

		expect(treeChanges(before, {})).toEqual([]);
	});

	it("should find a key Rojo took off a node", () => {
		const before: RojoNode = {
			$className: "Folder",
			$properties: { Color: [1, 0, 0] },
		};
		const after: RojoNode = { $className: "Folder" };

		expect(treeChanges(before, after)).toEqual([
			{ node: [], set: {}, remove: ["$properties"], added: [] },
		]);
	});

	it("should find a node Rojo added, and ignore one it left out", () => {
		const before: RojoNode = { Gone: { $className: "Folder" } };
		const after: RojoNode = {
			New: { $className: "StringValue", $properties: { Value: "a" } },
		};

		expect(treeChanges(before, after)).toEqual([
			{
				node: [],
				set: {},
				remove: [],
				added: [
					{
						name: "New",
						node: {
							$className: "StringValue",
							$properties: { Value: "a" },
						},
					},
				],
			},
		]);
	});
});

describe("applyTreeChanges", () => {
	const TEXT = [
		"{",
		'  "name": "game",',
		'  "tree": {',
		'    "$className": "Folder",',
		'    "Value": { "$className": "StringValue" },',
		'    "File": { "$path": "src/a.txt" }',
		"  }",
		"}",
	].join("\n");

	const set = (node: string[], values: Record<string, unknown>) => ({
		node,
		set: values,
		remove: [],
		added: [],
	});

	it("should set a property on a node the tree has, keeping the rest of the file", () => {
		const applied = applyTreeChanges(
			TEXT,
			["tree"],
			[set(["Value"], { $properties: { Value: "x" } })]
		);

		expect(JSON.parse(applied.text).tree.Value).toEqual({
			$className: "StringValue",
			$properties: { Value: "x" },
		});
		expect(applied.text).toContain('"File": { "$path": "src/a.txt" }');
		expect(applied.unhomed).toEqual([]);
	});

	it("should keep a comment in a jsonc file", () => {
		const text = TEXT.replace('"name"', '// the game\n  "name"');

		const applied = applyTreeChanges(
			text,
			["tree"],
			[set(["File"], { $attributes: { Level: 1 } })]
		);

		expect(applied.text).toContain("// the game");
		expect(
			JSON.parse(applied.text.replace("// the game", "")).tree.File
		).toEqual({ $path: "src/a.txt", $attributes: { Level: 1 } });
	});

	it("should remove a key", () => {
		const text = TEXT.replace(
			'"StringValue" }',
			'"StringValue", "$properties": { "Value": "x" } }'
		);

		const applied = applyTreeChanges(
			text,
			["tree"],
			[{ node: ["Value"], set: {}, remove: ["$properties"], added: [] }]
		);

		expect(JSON.parse(applied.text).tree.Value).toEqual({
			$className: "StringValue",
		});
	});

	it("should add a node under a node the tree has", () => {
		const applied = applyTreeChanges(
			TEXT,
			["tree"],
			[
				{
					node: [],
					set: {},
					remove: [],
					added: [{ name: "New", node: { $className: "Folder" } }],
				},
			]
		);

		expect(JSON.parse(applied.text).tree.New).toEqual({
			$className: "Folder",
		});
	});

	it("should leave out a node added with a path, which points into the mirror", () => {
		const applied = applyTreeChanges(
			TEXT,
			["tree"],
			[
				{
					node: [],
					set: {},
					remove: [],
					added: [
						{
							name: "Deep",
							node: { Inner: { $path: "mirror/a.txt" } },
						},
					],
				},
			]
		);

		expect(applied.text).toBe(TEXT);
		expect(applied.unhomed).toEqual([["Deep"]]);
	});

	it("should write with the indentation of the file, not of a comment", () => {
		const text = [
			"/*",
			" * a config",
			" */",
			"{",
			'    "tree": {',
			'        "Value": {',
			'            "$className": "StringValue"',
			"        }",
			"    }",
			"}",
		].join("\n");

		const applied = applyTreeChanges(
			text,
			["tree"],
			[set(["Value"], { $properties: { Value: "x" } })]
		);

		expect(applied.text).toContain('\n        "Value": {');
		expect(applied.text).toContain('\n            "$properties": {');
	});

	it("should edit the tree of a project of the file", () => {
		const text = JSON.stringify({
			projects: {
				release: { tree: { Value: { $className: "StringValue" } } },
			},
		});

		const applied = applyTreeChanges(
			text,
			["projects", "release", "tree"],
			[set(["Value"], { $attributes: { A: true } })]
		);

		expect(JSON.parse(applied.text).projects.release.tree.Value).toEqual({
			$className: "StringValue",
			$attributes: { A: true },
		});
	});

	it("should leave out a change to a node the tree does not have", () => {
		const applied = applyTreeChanges(
			TEXT,
			["tree"],
			[set(["Made"], { $properties: { Value: "x" } })]
		);

		expect(applied.text).toBe(TEXT);
		expect(applied.unhomed).toEqual([["Made"]]);
	});

	it("should leave the text alone when there are no changes", () => {
		expect(applyTreeChanges(TEXT, ["tree"], [])).toEqual({
			text: TEXT,
			unhomed: [],
		});
	});

	it("should leave out every change when the text is not JSON", () => {
		const applied = applyTreeChanges(
			"{ nope",
			["tree"],
			[set(["Value"], { $attributes: { A: 1 } })]
		);

		expect(applied.text).toBe("{ nope");
		expect(applied.unhomed).toEqual([["Value"]]);
	});
});
