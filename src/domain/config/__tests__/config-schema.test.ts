import { JSONSchema } from "../../../base/json-schema.js";
import { JsoncNode } from "../../../base/jsonc.js";
import {
	configDefaults,
	configMergePolicies,
	configSchema,
	configWrongTypeAdvice,
} from "../config-schema.js";

describe("domain/config/config-schema", () => {
	describe("configSchema", () => {
		const schema = configSchema;

		const ROOT_FIELDS = [
			"$schema",
			"extends",
			"rootDirs",
			"routes",
			"variants",
			"conflicts",
			"modes",
			"mode",
			"exclude",
			"template",
			"syncDir",
			"outFile",
		];

		const UNSUPPORTED_FIELDS = [
			"source",
			"verbatim",
			"unwrap",
			"casing",
			"aliases",
			"globIgnorePaths",
			"luau",
			"ts",
			"darklua",
			"profiles",
			"outputs",
			"sourceProject",
		];

		describe("schema shape", () => {
			it("declares exactly the root config fields", () => {
				expect(Object.keys(schema.properties!).sort()).toEqual(
					[...ROOT_FIELDS].sort()
				);
			});

			it("rejects unknown top-level keys", () => {
				expect(schema.additionalProperties).toBe(false);
			});

			it.each(UNSUPPORTED_FIELDS)(
				"does not declare the unsupported field %s",
				(field) => {
					expect(schema.properties![field]).toBeUndefined();
				}
			);
		});

		describe("defaults", () => {
			it('defaults rootDirs to ["src"]', () => {
				expect(schema.properties!.rootDirs.default).toEqual(["src"]);
			});

			it("defaults routes to {}", () => {
				expect(schema.properties!.routes.default).toEqual({});
			});

			it("defaults variants and conflicts to []", () => {
				expect(schema.properties!.variants.default).toEqual([]);
				expect(schema.properties!.conflicts.default).toEqual([]);
			});

			it("defaults exclude to []", () => {
				expect(schema.properties!.exclude.default).toEqual([]);
			});

			it("has no static default for modes or mode", () => {
				expect(schema.properties!.modes.default).toBeUndefined();
				expect(schema.properties!.mode.default).toBeUndefined();
			});

			it("has no static default for template, syncDir or outFile", () => {
				expect(schema.properties!.template.default).toBeUndefined();
				expect(schema.properties!.syncDir.default).toBeUndefined();
				expect(schema.properties!.outFile.default).toBeUndefined();
			});
		});

		it("carries a description on every field", () => {
			for (const field of ROOT_FIELDS) {
				expect(schema.properties![field].description).toBeTruthy();
			}
		});
	});

	describe("variants", () => {
		it("are a list of names", () => {
			expect(configSchema.properties!.variants).toMatchObject({
				type: "array",
				items: { type: "string" },
			});
		});

		it("are turned on by a mode through a list of names", () => {
			const body = configSchema.properties!.modes
				.additionalProperties as JSONSchema;

			expect(body.properties!.variants).toMatchObject({
				type: "array",
				items: { type: "string" },
			});
		});
	});

	describe("conflicts", () => {
		it("are a list of groups of names", () => {
			expect(configSchema.properties!.conflicts).toMatchObject({
				type: "array",
				items: { type: "array", items: { type: "string" } },
			});
		});
	});

	describe("wrong type advice", () => {
		const object = { kind: "object" } as JsoncNode;
		const location = { resource: "/repo/default.rogen.json" };

		it("says variants is a list when a config writes the old map", () => {
			expect(
				configWrongTypeAdvice("variants", object, location)
			).toMatchObject({
				code: "config.variantsAreAList",
				message: expect.stringContaining('"variants" is a list'),
			});
		});

		it("says the same of the variants of a mode", () => {
			expect(
				configWrongTypeAdvice("modes.dev.variants", object, location)
			).toMatchObject({
				code: "config.variantsAreAList",
				message: expect.stringContaining('"modes.dev.variants"'),
			});
		});

		it("leaves any other wrong value to the generic message", () => {
			expect(
				configWrongTypeAdvice("routes", object, location)
			).toBeUndefined();
			expect(
				configWrongTypeAdvice(
					"variants",
					{ kind: "string" } as JsoncNode,
					location
				)
			).toBeUndefined();
		});
	});

	describe("mode bodies", () => {
		it("hold only variants and exclude", () => {
			const body = configSchema.properties!.modes
				.additionalProperties as JSONSchema;

			expect(body.additionalProperties).toBe(false);
			expect(Object.keys(body.properties!).sort()).toEqual([
				"exclude",
				"variants",
			]);
		});
	});

	describe("configMergePolicies", () => {
		it("names a policy for every field", () => {
			expect(Object.keys(configMergePolicies).sort()).toEqual(
				Object.keys(configSchema.properties!).sort()
			);
		});

		it("adds list entries, merges maps and replaces strings", () => {
			expect(configMergePolicies).toMatchObject({
				rootDirs: "append",
				exclude: "append",
				routes: "merge",
				variants: "append",
				conflicts: "append",
				modes: { each: { variants: "append", exclude: "append" } },
				template: "replace",
				syncDir: "replace",
				mode: "replace",
			});
		});
	});

	describe("configDefaults", () => {
		it("holds exactly the fields the schema gives a default", () => {
			expect(configDefaults.contents).toEqual({
				rootDirs: ["src"],
				routes: {},
				variants: [],
				conflicts: [],
				exclude: [],
			});
		});
	});
});
