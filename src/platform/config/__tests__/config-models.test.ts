import { Config, ConfigModel } from "../config-models.js";

describe("platform/config/config-models", () => {
	describe("Config", () => {
		it("should merge maps key by key and replace lists across three layers when no policy says otherwise", () => {
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

		describe("append policy", () => {
			const policies = { list: "append", scalar: "replace" } as const;
			const of = (layers: Record<string, unknown>[], defaults = {}) =>
				new Config(
					new ConfigModel(defaults),
					layers.map((layer) => new ConfigModel(layer)),
					new ConfigModel(),
					policies
				);

			it("should add each layer's entries to the earlier ones", () => {
				const config = of([
					{ list: ["a"] },
					{ scalar: "x" },
					{ list: ["b", "c"] },
				]);

				expect(config.getValue("list")).toEqual(["a", "b", "c"]);
			});

			it("should keep a repeated entry at its last position", () => {
				const config = of([{ list: ["a", "b"] }, { list: ["a", "c"] }]);

				expect(config.getValue("list")).toEqual(["b", "a", "c"]);
			});

			it("should keep a repeat inside one layer's own list", () => {
				const config = of([{ list: ["a"] }, { list: ["b", "b"] }]);

				expect(config.getValue("list")).toEqual(["a", "b", "b"]);
			});

			it("should use the default only when no layer sets the list", () => {
				expect(of([{}], { list: ["d"] }).getValue("list")).toEqual([
					"d",
				]);
				expect(
					of([{ list: ["a"] }], { list: ["d"] }).getValue("list")
				).toEqual(["a"]);
			});

			it("should name the layer and position that wrote each entry", () => {
				const config = of([{ list: ["a", "b"] }, { list: ["c", "a"] }]);

				expect(config.entries("list")).toEqual([
					{
						value: "b",
						source: { tier: "layer", index: 0 },
						index: 1,
					},
					{
						value: "c",
						source: { tier: "layer", index: 1 },
						index: 0,
					},
					{
						value: "a",
						source: { tier: "layer", index: 1 },
						index: 1,
					},
				]);
			});
		});

		describe("each policy", () => {
			const policies = {
				modes: { each: { variants: "merge", exclude: "append" } },
			} as const;
			const of = (layers: Record<string, unknown>[]) =>
				new Config(
					new ConfigModel(),
					layers.map((layer) => new ConfigModel(layer)),
					new ConfigModel(),
					policies
				);

			it("should merge a map by key and each value by its field policies", () => {
				const config = of([
					{
						modes: {
							dev: { variants: { a: true }, exclude: ["x"] },
							prod: { exclude: ["y"] },
						},
					},
					{
						modes: {
							prod: { variants: { b: false }, exclude: ["z"] },
							staging: {},
						},
					},
				]);

				expect(config.getValue("modes")).toEqual({
					dev: { variants: { a: true }, exclude: ["x"] },
					prod: { exclude: ["y", "z"], variants: { b: false } },
					staging: {},
				});
			});

			it("should keep the order mode names were first declared in", () => {
				const config = of([
					{ modes: { b: {}, a: {} } },
					{ modes: { c: {}, a: {} } },
				]);

				expect(Object.keys(config.getValue("modes") ?? {})).toEqual([
					"b",
					"a",
					"c",
				]);
			});

			it("should name the layer and position that wrote a nested entry", () => {
				const config = of([
					{ modes: { prod: { exclude: ["a"] } } },
					{ modes: { prod: { exclude: ["b"] } } },
				]);

				expect(config.entries(["modes", "prod", "exclude"])).toEqual([
					{
						value: "a",
						source: { tier: "layer", index: 0 },
						index: 0,
					},
					{
						value: "b",
						source: { tier: "layer", index: 1 },
						index: 0,
					},
				]);
			});
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

		describe("equals", () => {
			it("should tell whether the merged values are the same", () => {
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

				expect(before.equals(after)).toBe(false);
				expect(before.equals(before)).toBe(true);
			});
		});
	});
});
