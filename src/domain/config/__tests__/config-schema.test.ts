import { JSONSchema } from "../../../base/json-schema.js";
import {
	configDefaults,
	configMergePolicies,
	configSchema,
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

			it("defaults variants to {}", () => {
				expect(schema.properties!.variants.default).toEqual({});
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
				variants: "merge",
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
				variants: {},
				exclude: [],
			});
		});
	});
});
