import { Registry } from "../registry.js";

describe("Registry", () => {
	it("should hand back what was added under an id", () => {
		const data = { name: "x" };

		Registry.add("test.registry.found", data);

		expect(Registry.as("test.registry.found")).toBe(data);
	});

	it("should refuse a second entry under one id", () => {
		Registry.add("test.registry.twice", {});

		expect(() => Registry.add("test.registry.twice", {})).toThrow(
			"already a registry entry"
		);
	});

	it("should refuse an id nothing was added under", () => {
		expect(() => Registry.as("test.registry.missing")).toThrow(
			"no registry entry"
		);
	});
});
