import { Config, ConfigModel } from "../config-models.js";

describe("platform/config/config-models", () => {
	describe("Config", () => {
		it("should merge maps key by key and replace lists across three layers", () => {
			const config = new Config(
				new ConfigModel({ list: ["default"] }),
				[
					new ConfigModel({
						map: { a: "root", b: "root" },
						list: ["root"],
					}),
					new ConfigModel({ map: { b: "middle", c: "middle" } }),
					new ConfigModel({ map: { c: "leaf" }, list: ["leaf"] }),
				],
				new ConfigModel()
			);

			expect(config.getValue("map")).toEqual({
				a: "root",
				b: "middle",
				c: "leaf",
			});
			expect(config.getValue("list")).toEqual(["leaf"]);
		});

		it("should let the cli tier override every layer", () => {
			const config = new Config(
				new ConfigModel({ value: "default" }),
				[new ConfigModel({ value: "layer" })],
				new ConfigModel({ value: "cli" })
			);

			expect(config.getValue("value")).toBe("cli");
		});

		describe("inspect", () => {
			const config = new Config(
				new ConfigModel({ a: "default", b: "default", c: "default" }),
				[
					new ConfigModel({ a: "root", b: "root" }),
					new ConfigModel({ a: "leaf" }),
				],
				new ConfigModel({ c: "cli" })
			);

			it("should name the last layer that sets the value", () => {
				expect(config.inspect("a")).toEqual({
					defaultValue: "default",
					layerValues: ["root", "leaf"],
					cliValue: undefined,
					value: "leaf",
					source: { tier: "layer", index: 1 },
				});
				expect(config.inspect("b").source).toEqual({
					tier: "layer",
					index: 0,
				});
			});

			it("should name the cli tier when it wins", () => {
				expect(config.inspect("c").source).toEqual({ tier: "cli" });
			});

			it("should name the default tier when no layer sets the value", () => {
				const onlyDefault = new Config(
					new ConfigModel({ a: 1 }),
					[new ConfigModel()],
					new ConfigModel()
				);
				expect(onlyDefault.inspect("a").source).toEqual({
					tier: "default",
				});
			});

			it("should report no source for an unset value", () => {
				expect(config.inspect("missing").source).toBeUndefined();
			});

			it("should inspect one key of a map on its own", () => {
				const layered = new Config(
					new ConfigModel(),
					[
						new ConfigModel({ map: { a: 1, b: 1 } }),
						new ConfigModel({ map: { a: 2 } }),
					],
					new ConfigModel()
				);
				expect(layered.inspect(["map", "b"]).source).toEqual({
					tier: "layer",
					index: 0,
				});
				expect(layered.inspect(["map", "a"]).source).toEqual({
					tier: "layer",
					index: 1,
				});
			});
		});

		describe("compare", () => {
			it("should list the keys whose merged value differs", () => {
				const before = new Config(
					new ConfigModel({ a: 1 }),
					[new ConfigModel({ b: { c: 1 }, d: 1 })],
					new ConfigModel()
				);
				const after = new Config(
					new ConfigModel({ a: 1 }),
					[new ConfigModel({ b: { c: 2 }, d: 1, e: 1 })],
					new ConfigModel()
				);

				expect(before.compare(after).sort()).toEqual(["b", "e"]);
			});
		});
	});
});
