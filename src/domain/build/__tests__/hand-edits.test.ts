import { HandEdits } from "../hand-edits.js";
import { WrittenRecords } from "../written-records.js";

const file = (tree: object, rest: object = {}) =>
	JSON.stringify({ ...rest, tree: { $className: "DataModel", ...tree } });

describe("HandEdits", () => {
	describe("lost", () => {
		it("should find a node the new file lacks, once, at its topmost missing node", () => {
			const lost = HandEdits.lost(
				file({ ServerStorage: { Assets: { $className: "Folder" } } }),
				file({})
			);

			expect(lost).toEqual([
				{
					kind: "node",
					instancePath: ["ServerStorage"],
					value: { Assets: { $className: "Folder" } },
				},
			]);
		});

		it("should find a property that the new file holds differently", () => {
			const lost = HandEdits.lost(
				file({ Workspace: { $properties: { Gravity: 10 } } }),
				file({ Workspace: { $properties: { Gravity: 196 } } })
			);

			expect(lost).toEqual([
				{
					kind: "node",
					instancePath: ["Workspace"],
					key: "$properties",
					value: { Gravity: 10 },
				},
			]);
		});

		it("should find a key of the file", () => {
			expect(
				HandEdits.lost(file({}, { servePort: 1 }), file({}))
			).toEqual([{ kind: "file", key: "servePort", value: 1 }]);
		});

		it("should find nothing in a file that only adds a name or has fewer nodes", () => {
			const written = file({ A: { $className: "Folder" } });

			expect(
				HandEdits.lost(
					JSON.stringify({ name: "x", ...JSON.parse(written) }),
					written
				)
			).toEqual([]);
			expect(HandEdits.lost(file({}), written)).toEqual([]);
		});

		it("should say nothing of a file that is not JSON", () => {
			expect(HandEdits.lost("{ nope", file({}))).toBeUndefined();
		});
	});

	describe("asTree and asKeys", () => {
		it("should put each node under its parents, and the keys of the file aside", () => {
			const lost = HandEdits.lost(
				file(
					{
						ServerStorage: { Assets: { $className: "Folder" } },
						Workspace: { $properties: { Gravity: 10 } },
					},
					{ servePort: 1 }
				),
				file({ Workspace: { $properties: { Gravity: 196 } } })
			)!;

			expect(HandEdits.asTree(lost)).toEqual({
				ServerStorage: { Assets: { $className: "Folder" } },
				Workspace: { $properties: { Gravity: 10 } },
			});
			expect(HandEdits.asKeys(lost)).toEqual({ servePort: 1 });
		});
	});

	describe("a node named like a prototype key", () => {
		it("should keep it as an entry of the tree", () => {
			const lost = HandEdits.lost(file({ ["__proto__"]: {} }), file({}));
			const tree = HandEdits.asTree(lost ?? []);

			expect(Object.keys(tree)).toEqual(["__proto__"]);
		});
	});

	describe("naming an edit", () => {
		it("should name a node by its instance path, and a key of it in brackets", () => {
			expect(
				HandEdits.describe({
					kind: "node",
					instancePath: ["A", "B"],
					value: {},
				})
			).toBe("A/B");
			expect(
				HandEdits.describe({
					kind: "node",
					instancePath: ["A"],
					key: "$className",
					value: "Folder",
				})
			).toBe("A ($className)");
		});
	});
});

describe("WrittenRecords", () => {
	it("should remember the hash of what was written, per file", async () => {
		const records = new WrittenRecords();

		await records.remember("/a.json", "one");

		expect(await records.lastWritten("/a.json")).toBe(
			WrittenRecords.hashOf("one")
		);
		expect(await records.lastWritten("/b.json")).toBeUndefined();
	});
});
