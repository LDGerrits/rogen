import {
	onlySerializedOverrides,
	withoutSerializedOverrides,
} from "../without-serialized-overrides.js";

const empty = { BinaryString: "" };

describe("withoutSerializedOverrides", () => {
	it("should take an empty SerializedOverrides out of a meta file, with the properties it leaves empty", () => {
		expect(
			withoutSerializedOverrides({
				properties: { SerializedOverrides: empty },
			})
		).toEqual({});
	});

	it("should keep the other properties and attributes of a meta file", () => {
		expect(
			withoutSerializedOverrides({
				className: "Folder",
				properties: { SerializedOverrides: empty, Anchored: true },
				attributes: { Level: 3 },
			})
		).toEqual({
			className: "Folder",
			properties: { Anchored: true },
			attributes: { Level: 3 },
		});
	});

	it("should take it out of every node of a tree", () => {
		expect(
			withoutSerializedOverrides({
				$className: "DataModel",
				$properties: { SerializedOverrides: empty },
				Workspace: {
					$path: "place/Workspace",
					$properties: { SerializedOverrides: empty, Gravity: 10 },
				},
			})
		).toEqual({
			$className: "DataModel",
			Workspace: {
				$path: "place/Workspace",
				$properties: { Gravity: 10 },
			},
		});
	});

	it("should take it out of the children of a model file", () => {
		expect(
			withoutSerializedOverrides({
				className: "Model",
				children: [
					{
						name: "Part",
						className: "Part",
						properties: { SerializedOverrides: empty },
					},
				],
			})
		).toEqual({
			className: "Model",
			children: [{ name: "Part", className: "Part" }],
		});
	});

	it("should keep a SerializedOverrides that holds data", () => {
		const meta = {
			properties: { SerializedOverrides: { BinaryString: "AQI=" } },
		};

		expect(withoutSerializedOverrides(meta)).toEqual(meta);
	});

	it("should keep an attribute named SerializedOverrides", () => {
		const meta = { attributes: { SerializedOverrides: empty } };

		expect(withoutSerializedOverrides(meta)).toEqual(meta);
	});
});

describe("onlySerializedOverrides", () => {
	const overrides = JSON.stringify({
		properties: { SerializedOverrides: empty },
	});

	it("should be true for a new meta file that holds only an empty SerializedOverrides", () => {
		expect(onlySerializedOverrides(undefined, overrides)).toBe(true);
	});

	it("should be true for a file Rojo added only an empty SerializedOverrides to", () => {
		expect(
			onlySerializedOverrides(
				'{ "className": "Part", "properties": { "Anchored": true } }',
				JSON.stringify({
					className: "Part",
					properties: { SerializedOverrides: empty, Anchored: true },
				})
			)
		).toBe(true);
	});

	it("should be false when a property also changed", () => {
		expect(
			onlySerializedOverrides(
				'{ "properties": { "Anchored": true } }',
				JSON.stringify({
					properties: { SerializedOverrides: empty, Anchored: false },
				})
			)
		).toBe(false);
	});

	it("should be false when an attribute was also set", () => {
		expect(
			onlySerializedOverrides(
				undefined,
				JSON.stringify({
					properties: { SerializedOverrides: empty },
					attributes: { Level: 3 },
				})
			)
		).toBe(false);
	});

	it("should be false for a new meta file with nothing in it", () => {
		expect(onlySerializedOverrides(undefined, "{}")).toBe(false);
	});

	it("should be false for a file that is not JSON", () => {
		expect(onlySerializedOverrides(undefined, 'return "hit"\n')).toBe(
			false
		);
	});
});
