import { ConfigModel } from "../config-models.js";

describe("platform/config/config-models", () => {
	describe("ConfigModel", () => {
		it("should give every value when no section is asked for", () => {
			expect(new ConfigModel({ a: 1 }).getValue()).toEqual({ a: 1 });
		});

		it("should give nothing below a value that isn't a map", () => {
			expect(new ConfigModel({ a: 1 }).getValue("a.b")).toBeUndefined();
			expect(
				new ConfigModel({ a: null }).getValue("a.b")
			).toBeUndefined();
		});

		it("should read a key the model owns, and none it inherits", () => {
			const model = new ConfigModel({ map: { own: 1 } });

			expect(model.getValue("map.own")).toBe(1);
			expect(model.getValue("map.toString")).toBeUndefined();
		});
	});
});
